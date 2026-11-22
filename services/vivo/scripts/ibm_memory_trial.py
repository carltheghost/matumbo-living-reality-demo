"""Compare local and IBM Quantum sampling for a synthetic Vivo memory objective.

Install qiskit-ibm-runtime in a virtual environment. Run this script without
arguments for a local simulation. For a hardware run, set IBM_QUANTUM_API_KEY
and IBM_QUANTUM_INSTANCE in the environment and pass --submit BACKEND.
The command prints a job ID. Use --result JOB_ID to retrieve its counts.
Only synthetic inputs are used.
"""

import argparse
import os
from itertools import product

import numpy as np
from qiskit import QuantumCircuit
from qiskit.circuit.library import DiagonalGate
from qiskit.primitives import StatevectorSampler
from qiskit.transpiler import generate_preset_pass_manager

CANDIDATES = [(9, 20), (9, 19), (6, 12), (6, 11), (6, 10), (3, 5)]
BUDGET = 18


def score(bits):
    tokens = sum(bit * cost for bit, (cost, _) in zip(bits, CANDIDATES))
    value = sum(bit * value for bit, (_, value) in zip(bits, CANDIDATES))
    return tokens, value - 20 * bits[0] * bits[1]


def memory_circuit():
    circuit = QuantumCircuit(len(CANDIDATES))
    diagonal = []
    for bits in product((0, 1), repeat=circuit.num_qubits):
        tokens, value = score(bits)
        phase_score = value if tokens <= BUDGET else -20
        diagonal.append(np.exp(-1j * (5 * np.pi / 12) * phase_score / 40))
    circuit.h(range(circuit.num_qubits))
    circuit.append(DiagonalGate(diagonal), range(circuit.num_qubits))
    circuit.rx(np.pi / 8, range(circuit.num_qubits))
    circuit.measure_all()
    return circuit


def summarize(counts):
    feasible = optimal = 0
    for outcome, count in counts.items():
        tokens, value = score(tuple(map(int, outcome)))
        if tokens <= BUDGET:
            feasible += count
            optimal += count * (value == 37)
    return {"shots": sum(counts.values()), "feasible": feasible, "optimal": optimal}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--submit", metavar="BACKEND")
    modes.add_argument("--result", metavar="JOB_ID")
    args = parser.parse_args()

    if not (args.submit or args.result):
        result = StatevectorSampler(seed=42).run([memory_circuit()], shots=1024).result()
        print(summarize(result[0].data.meas.get_counts()))
        return

    from qiskit_ibm_runtime import QiskitRuntimeService, SamplerV2

    service = QiskitRuntimeService(
        channel="ibm_quantum_platform",
        token=os.environ["IBM_QUANTUM_API_KEY"],
        instance=os.environ["IBM_QUANTUM_INSTANCE"],
    )
    if args.result:
        job = service.job(args.result)
        print(summarize(job.result()[0].data.meas.get_counts()))
        return

    backend = service.backend(args.submit)
    pass_manager = generate_preset_pass_manager(
        backend=backend, optimization_level=2, seed_transpiler=42
    )
    circuit = pass_manager.run(memory_circuit())
    sampler = SamplerV2(mode=backend, options={"max_execution_time": 60})
    job = sampler.run([circuit], shots=1024)
    print(job.job_id(), flush=True)


if __name__ == "__main__":
    main()
