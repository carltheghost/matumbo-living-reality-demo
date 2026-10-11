const fail=code=>{throw Object.assign(new Error(code),{code});};const copy=v=>structuredClone(v);
export class ToolRegistry{
  constructor(){this.tools=new Map();}
  register(name,fn,{description='',risk='read'}={}){if(typeof name!=='string'||!name||typeof fn!=='function'||this.tools.has(name))fail('INVALID_TOOL_REGISTRATION');if(!['read','interactive'].includes(risk))fail('INVALID_TOOL_RISK');this.tools.set(name,{name,fn,description,risk});return this;}
  list(){return[...this.tools.values()].map(({fn,...x})=>copy(x));}
  async call(name,args,context){const tool=this.tools.get(name);if(!tool)fail('UNKNOWN_TOOL');return tool.fn(copy(args??{}),context);}
}
export class AgentRuntime{
  constructor({tools=new ToolRegistry(),maxSteps=24,maxConcurrent=2}={}){this.tools=tools;this.maxSteps=maxSteps;this.maxConcurrent=maxConcurrent;this.agents=new Map();this.running=0;this.planner=null;}
  setPlanner(fn){if(fn!==null&&typeof fn!=='function')fail('INVALID_PLANNER');this.planner=fn;return this;}
  register(agent){if(!agent||typeof agent.id!=='string'||!agent.id||typeof agent.decide!=='function'||this.agents.has(agent.id))fail('INVALID_AGENT');this.agents.set(agent.id,agent);return this;}
  async run(agentId,task,context={}){
    if(this.running>=this.maxConcurrent)fail('AGENT_CAPACITY');const agent=this.agents.get(agentId);if(!agent)fail('NO_AGENT');this.running++;
    try{const trace=[],state={task:copy(task),memory:{},step:0};while(state.step++<this.maxSteps){const action=await agent.decide(copy(state),{tools:this.tools.list(),planner:this.planner,context});if(!action||typeof action!=='object')fail('INVALID_AGENT_ACTION');if(action.type==='done')return{result:copy(action.result),trace};if(action.type!=='tool'||typeof action.tool!=='string')fail('INVALID_AGENT_ACTION');const started=performance.now();try{const value=await this.tools.call(action.tool,action.args??{},context);trace.push({step:state.step,tool:action.tool,ok:true,ms:performance.now()-started});state.memory.last={tool:action.tool,ok:true,value:copy(value)};}catch(error){trace.push({step:state.step,tool:action.tool,ok:false,code:error?.code??'TOOL_FAILED',ms:performance.now()-started});state.memory.last={tool:action.tool,ok:false,code:error?.code??'TOOL_FAILED'};}}fail('AGENT_STEP_LIMIT');}finally{this.running--;}
  }
}
export function installPhoneAgents(runtime){
  runtime.register({id:'phone.operator',description:'Runs a bounded explicit tool plan.',async decide(state){const actions=Array.isArray(state.task?.actions)?state.task.actions:[],i=state.step-1;if(i>=actions.length)return{type:'done',result:{completed:actions.length,last:state.memory.last??null}};const a=actions[i];return a&&typeof a.tool==='string'?{type:'tool',tool:a.tool,args:a.args??{}}:{type:'done',result:{completed:i,error:'INVALID_ACTION'}};}});
  runtime.register({id:'projection.conductor',description:'Keeps the phone awake and opens the native cast picker when available.',async decide(state){if(state.step===1)return{type:'tool',tool:'display.keepAwake',args:{enabled:true}};if(state.step===2)return{type:'tool',tool:'projection.openCastSettings',args:{}};return{type:'done',result:{projectionRequested:true}};}});
  runtime.register({id:'device.guardian',description:'Reads local device capability state.',async decide(state){if(state.step===1)return{type:'tool',tool:'device.info',args:{}};return{type:'done',result:{last:state.memory.last??null}};}});
  return runtime;
}
