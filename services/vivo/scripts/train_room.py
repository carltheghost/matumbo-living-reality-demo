"""Reproducible synthetic task, with independent train/validation/test seeds."""
from pathlib import Path
import sys,copy,json,hashlib
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import numpy as np
import torch
from server.adaptive import teacher

def main():
    torch.set_num_threads(1);torch.manual_seed(818)
    xs=[np.random.default_rng(s).uniform(0,1,(n,4)).astype('float32') for s,n in [(801,6000),(802,1000),(803,2000)]]
    ts=[torch.tensor(x) for x in xs];ys=[torch.tensor(teacher(x)).reshape(-1,1) for x in xs]
    net=torch.nn.Sequential(torch.nn.Linear(4,16),torch.nn.Tanh(),torch.nn.Linear(16,16),torch.nn.Tanh(),torch.nn.Linear(16,1))
    def run(x):return 1+3*torch.sigmoid(net(x))
    opt=torch.optim.Adam(net.parameters(),lr=.008);best=1e10;checkpoint=None;stepbest=0
    generator=torch.Generator().manual_seed(804)
    for step in range(1200):
        ids=torch.randint(0,len(xs[0]),(256,),generator=generator);pred=run(ts[0][ids]);loss=((pred-ys[0][ids])**2).mean()
        opt.zero_grad();loss.backward();opt.step()
        if step%20==0:
            with torch.no_grad():v=float(((run(ts[1])-ys[1])**2).mean())
            if v<best:best=v;checkpoint=copy.deepcopy(net.state_dict());stepbest=step
    net.load_state_dict(checkpoint)
    with torch.no_grad():pred=run(ts[2]).numpy().ravel()
    target=teacher(xs[2]);flat=np.full_like(target,teacher(xs[0]).mean())
    # A quadratic feature regression is a stronger, correctly specified baseline.
    feat=lambda x:np.c_[np.ones(len(x)),x,x*x]
    b=np.linalg.lstsq(feat(xs[0]),teacher(xs[0]),rcond=None)[0];poly=feat(xs[2])@b
    weights={}
    for i,k in enumerate((0,2,4),1):
        weights['w'+str(i)]=net[k].weight.detach().numpy().T.tolist();weights['b'+str(i)]=net[k].bias.detach().numpy().tolist()
    report={'task':'Synthetic local comfort cost = 1 + .4 curvature² + 1.8 crowd + .35 noise² + .25 roughness',
            'training_examples':6000,'validation_examples':1000,'test_examples':2000,'seeds':[801,802,803],
            'selection':'validation only; independent test drawn before training, only evaluated after selection',
            'selected_step':stepbest,'validation_mse':best,'test_neural_mse':float(np.mean((pred-target)**2)),
            'test_constant_mse':float(np.mean((flat-target)**2)),'test_quadratic_mse':float(np.mean((poly-target)**2)),
            'parameters':sum(p.numel() for p in net.parameters()),'scope':'Learned local cost rule; graph relaxation itself is explicit, not learned. Analytic/quadratic baseline is better.',
            'general_intelligence':False,'personal_data':False}
    root=Path(__file__).resolve().parents[1]
    (root/'models'/'room-rule.json').write_text(json.dumps({'weights':weights,'provenance':report},separators=(',',':')))
    (root/'reports'/'room-training.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2))
if __name__=='__main__':main()
