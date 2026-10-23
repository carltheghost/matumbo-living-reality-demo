"""Local, inference-only laboratory host over the recovered five-brain bundle.

No network listener, training, optimizer, private-note import, or model promotion.
Ablations alter fresh episode masks, never installed parameters. stdin is a trusted
host port, not an untrusted plugin sandbox. Fixture notes are synthetic.
"""
from __future__ import annotations
import argparse
from dataclasses import replace
import hashlib
import json
from pathlib import Path
import sys

MODES = ('intact', 'no_lateral', 'no_memory', 'no_branch0', 'no_branch1',
         'no_branch2', 'no_branch3', 'silence_decision')
MAX_LINE = 200_000


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'),
                                    allow_nan=False).encode()).hexdigest()


class LabProvider:
    def __init__(self, bundle: Path, state: Path):
        self.bundle = bundle.resolve(strict=True)
        sys.path.insert(0, str(self.bundle / 'native/src'))
        from vevo_agents.workspace import NoteWorkspace
        from vevo_agents.stage6_inference_runtime import load_shared_core_inference
        manifest = json.loads((self.bundle / 'config/convergence.json').read_text())
        spec = manifest['neural']
        self.runtime = load_shared_core_inference(self.bundle / 'native/checkpoint',
                          cell_id=spec['cell_id'], update=spec['update'])
        if self.runtime.parameter_digest != spec['parameter_digest']:
            raise ValueError('CHECKPOINT_IDENTITY_MISMATCH')
        state.mkdir(parents=True, exist_ok=True)
        self.memory = NoteWorkspace(str(state / 'synthetic-memory.sqlite3'))
        for bit in (0, 1):
            note_id = f'lab:cue:{bit}'
            text = json.dumps({'schema': 'vivo.cooperation.cue/1', 'code': bit}, sort_keys=True)
            rows = self.memory.conn.execute('SELECT text FROM documents WHERE note_id=?', (note_id,)).fetchall()
            if not rows:
                self.memory.create(note_id, f'Cooperation fixture code {bit}', text, tick=0)
            elif rows[0]['text'] != text:
                raise ValueError('EXISTING_LAB_NOTE_CONFLICT')

    def predict(self, payload, mode='intact'):
        import numpy as np
        from vevo_agents.stage6_task_adapters import SameCoreTaskAdapter
        if mode not in MODES or type(payload) is not dict or set(payload) != {'cue', 'query', 'delay_steps', 'distractor'}:
            raise ValueError('INVALID_LAB_INPUT')
        cue, query, delay, distractor = (payload[k] for k in ('cue','query','delay_steps','distractor'))
        if type(cue) is not int or cue not in (0,1) or type(query) is not int or query not in (0,1):
            raise ValueError('BINARY_INPUT_REQUIRED')
        if type(delay) is not int or not 0 <= delay <= 64 or type(distractor) not in (int,float) or not np.isfinite(distractor) or abs(distractor)>1:
            raise ValueError('INVALID_DELAY_OR_DISTRACTOR')
        core = self.runtime._core  # pinned research API; no modification of the recovered source
        self.runtime._assert_immutable_parameters()
        module_mask = np.ones(4)
        disabled = int(mode[-1]) if mode.startswith('no_branch') else None
        if disabled is not None:
            module_mask[disabled] = 0
        episode = core.initial_runtime(trajectory_id='vivo-cooperation-lab', module_presence=module_mask)
        if mode == 'no_memory':
            episode['memory_presence'] = np.zeros_like(episode['memory_presence'])
        stages = [('cue',cue,None)] + [('delay',None,None)]*delay + [('query',None,query)]
        trace = None
        for sequence, (stage, c, q) in enumerate(stages):
            batch = SameCoreTaskAdapter._retrieval_batch(event_id=f'lab-{sequence}', sequence=sequence,
                timestamp=.25*(sequence+1), stage=stage, cue=c, query=q, distractor=float(distractor))
            observations = []
            for obs in batch.observations:
                changes = {}
                if mode == 'no_lateral':
                    changes.update(read_nodes=(), write_nodes=())
                if mode == 'no_memory':
                    changes.update(read_central_memory=False, write_central_memory=False)
                if disabled is not None:
                    changes.update(read_nodes=tuple(n for n in obs.read_nodes if n != disabled),
                                   write_nodes=tuple(n for n in obs.write_nodes if n != disabled))
                    if obs.node_id == disabled:
                        changes.update(context=tuple(0.0 for _ in obs.context), read_nodes=(), write_nodes=(),
                            read_central_memory=False, write_central_memory=False, write_central_state=False)
                observations.append(replace(obs, **changes))
            batch = replace(batch, observations=tuple(observations))
            episode, trace = core.step_node_observations(episode, batch)
        representation = SameCoreTaskAdapter.representation_from_trace(trace)
        logits = self.runtime._readouts['scoped_delayed_retrieval'].logits(representation)
        prediction = self.runtime._prediction(task='scoped_delayed_retrieval', logits=logits,
                                              checkpoint=self.runtime.checkpoint)
        prediction['input'] = dict(payload)
        if mode == 'silence_decision':
            prediction['predicted_index'] = None  # output ablation, NOT deletion of the central recurrence
        self.runtime._assert_immutable_parameters()
        return {'prediction': prediction, 'promotion': 'experimental_only', 'checkpoint_gate': 'rejected',
                'can_authorize_action': False, 'mode': mode, 'steps': len(stages),
                'parameter_digest': self.runtime.parameter_digest,
                'scalar_parameters': self.runtime.scalar_parameter_count,
                'tensor_count': self.runtime.tensor_key_count, 'training_performed': False,
                'communication_edge_0_to_1': float(trace['communication_permissions'][1,0]),
                'module_mask': module_mask.tolist(), 'output_sha256': digest(prediction)}

    def invoke(self, tool, args):
        if tool == 'memory.search':
            if set(args) != {'query'} or type(args['query']) is not str or not 1 <= len(args['query']) <= 128:
                raise ValueError('INVALID_QUERY')
            rows = self.memory.search(args['query'], exact=True)
            return {'matches': rows, 'total_matches': len(rows), 'truncated': False}
        if tool == 'memory.read':
            if set(args) != {'note_id'}:
                raise ValueError('INVALID_NOTE_REQUEST')
            document = self.memory._document(self.memory._require_id(args['note_id'])).snapshot()
            return {'document': document, 'sha256': digest(document), 'synthetic': True}
        if tool == 'neural.predict':
            if set(args) != {'task','input'} or args['task'] != 'scoped_delayed_retrieval':
                raise ValueError('UNSUPPORTED_TASK')
            return self.predict(args['input'])
        if tool == 'lab.predict':
            if set(args) != {'input','mode'}:
                raise ValueError('INVALID_ABLATION_REQUEST')
            return self.predict(args['input'], args['mode'])
        if tool == 'lab.parity':
            expected = self.runtime.predict('scoped_delayed_retrieval', args)
            measured = self.predict(args)['prediction']
            return {'equal': expected['logits'] == measured['logits'], 'expected': expected['logits'], 'measured': measured['logits']}
        raise ValueError('TOOL_NOT_AVAILABLE')

    def close(self):
        self.memory.close()


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--bundle',type=Path,required=True)
    parser.add_argument('--state',type=Path,required=True)
    args=parser.parse_args()
    provider=LabProvider(args.bundle,args.state)
    try:
        while True:
            raw=sys.stdin.buffer.readline(MAX_LINE+1)
            if not raw: break
            if len(raw)>MAX_LINE:
                raise ValueError('REQUEST_TOO_LARGE')
            request_id=None
            try:
                request=json.loads(raw);request_id=request.get('id')
                if type(request_id) is not int or type(request.get('args')) is not dict:
                    raise ValueError('INVALID_REQUEST')
                result=provider.invoke(request['tool'],request['args'])
                reply={'id':request_id,'result':result}
            except Exception as error:
                reply={'id':request_id,'error':type(error).__name__+': '+str(error)}
            print(json.dumps(reply,allow_nan=False),flush=True)
    finally:
        provider.close()

if __name__=='__main__':
    main()
