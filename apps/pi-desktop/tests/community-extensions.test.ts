/** Published default packages execute unchanged through official Pi RPC; optional input owns their installation. */
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {createServer} from 'node:http'
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {PiProcess} from '../bridge/process.ts'
import {isJsonObject,type JsonObject} from '../bridge/types.ts'
import {extensionCatalog} from '../bridge/extension-catalog.ts'
import {availableBundledRuntime,bundledPi} from '../runtime/bundled.ts'

test('published defaults run todo, RPC questions, a real child and web request rejection in official Pi', {timeout:90_000}, async context=>{
  const packages=process.env.PI_DESKTOP_TEST_EXTENSION_ROOT
  if(!packages){context.skip('Set PI_DESKTOP_TEST_EXTENSION_ROOT to the installed default packages node_modules');return}
  const bundled=await availableBundledRuntime(resolve('apps/pi-desktop'),process.env.PI_DESKTOP_TEST_RUNTIME)
  if(!bundled){context.skip('Prepare the selected native Pi runtime');return}
  const defaults=extensionCatalog.filter(item=>item.recommended)
  for(const item of defaults){const metadata=JSON.parse(await readFile(join(packages,item.name,'package.json'),'utf8'));assert.equal(metadata.version,item.version)}
  const root=await mkdtemp(join(tmpdir(),'pi-community-extensions-')),agentDir=join(root,'agent');await mkdir(agentDir)
  context.after(async()=>{await rm(root,{recursive:true,force:true})})
  let step=0,children=0,providerError:unknown
  const calls=[{name:'todo',args:{action:'create',subject:'Verify native extensions'}},{name:'ask_user_question',args:{questions:[{header:'Test',question:'Did the dialog arrive?',options:[{label:'Verified',description:'Accept'},{label:'Retry',description:'Try again'}]}]}},{name:'subagent',args:{agent:'delegate',task:'Reply only CHILD_FIXTURE_COMPLETED. Do not call tools.',model:'fixture/scripted',async:false,context:'fresh'}},{name:'fetch_content',args:{url:'http://127.0.0.1:1/private',mode:'raw'}}]
  const server=createServer((request,response)=>{void(async()=>{
    let text='';for await(const chunk of request)text+=String(chunk)
    const body:unknown=JSON.parse(text);assert.ok(isJsonObject(body)&&Array.isArray(body.messages))
    response.writeHead(200,{'content-type':'text/event-stream'})
    const delta=(value:JsonObject,finish:string|null=null)=>response.write('data: '+JSON.stringify({id:'community-fixture',object:'chat.completion.chunk',created:1,model:'scripted',choices:[{index:0,delta:value,finish_reason:finish}]})+'\n\n')
    const finish=(value:string)=>{delta({},value);response.end('data: [DONE]\n\n')}
    delta({role:'assistant'})
    if(body.messages.some(m=>isJsonObject(m)&&m.role==='user'&&JSON.stringify(m.content).includes('CHILD_FIXTURE_COMPLETED'))){children++;delta({content:'CHILD_FIXTURE_COMPLETED'});finish('stop');return}
    const tools=Array.isArray(body.tools)?body.tools.filter(isJsonObject):[]
    const has=(name:string)=>tools.some(tool=>isJsonObject(tool.function)&&tool.function.name===name)
    let call=calls[step]
    if(step===2&&has('subagents_enable')&&!has('subagent')){delta({tool_calls:[{index:0,id:'enable-child',type:'function',function:{name:'subagents_enable',arguments:'{}'}}]});finish('tool_calls');return}
    step++
    if(call){assert.ok(has(call.name),call.name+' is registered');delta({tool_calls:[{index:0,id:'check-'+step,type:'function',function:{name:call.name,arguments:JSON.stringify(call.args)}}]});finish('tool_calls')}
    else{delta({content:'COMMUNITY_CHECK_COMPLETE'});finish('stop')}
  })().catch(error=>{providerError=error;response.destroy(error)})})
  await new Promise<void>((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done)})
  context.after(async()=>{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()))})
  const address=server.address();assert.ok(address&&typeof address!=='string')
  await writeFile(join(agentDir,'models.json'),JSON.stringify({providers:{fixture:{baseUrl:`http://127.0.0.1:${address.port}/v1`,api:'openai-completions',apiKey:'fixture-only',models:[{id:'scripted',name:'Fixture',reasoning:false,input:['text'],contextWindow:128000,maxTokens:4096,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}}}))
  await writeFile(join(agentDir,'settings.json'),JSON.stringify({defaultProvider:'fixture',defaultModel:'scripted',compaction:{enabled:false}}))
  const base=bundledPi(bundled),pi=new PiProcess({...base,agentDir,cwd:root,args:[...base.args,'--no-extensions','--no-skills','--no-prompt-templates','--no-themes',...defaults.flatMap(item=>['-e',join(packages,item.name)])]})
  context.after(()=>pi.dispose())
  const results:JsonObject[]=[];let answered=false,settled!:()=>void,fail!:(error:unknown)=>void
  const done=new Promise<void>((complete,reject)=>{settled=complete;fail=reject})
  pi.subscribe(event=>{
    if(event.type==='extension_ui_request'&&event.method==='select'&&typeof event.id==='string'&&Array.isArray(event.options)){
      const answer=event.options.find(value=>typeof value==='string'&&value.includes('Verified'));assert.equal(typeof answer,'string');answered=true;void pi.request({type:'extension_ui_response',id:event.id,value:answer}).catch(fail)
    }
    if(event.type==='message_end'&&isJsonObject(event.message)&&event.message.role==='toolResult')results.push(event.message)
    if(event.type==='agent_settled')settled()
    if(event.type==='bridge_error')fail(new Error(String(event.error)))
  })
  await pi.start();await pi.request({type:'prompt',message:'Verify community tools and delegate a short fixture check.'});await done
  assert.equal(providerError,undefined);assert.equal(answered,true);assert.equal(children,1)
  for(const name of ['todo','ask_user_question','subagent'])assert.equal(results.find(value=>value.toolName===name)?.isError,false,name)
  const web=results.find(value=>value.toolName==='fetch_content');assert.ok(web)
  assert.match(JSON.stringify(web),/private|blocked|localhost|loopback/i)
  const messages=await pi.request({type:'get_messages'});assert.match(JSON.stringify(messages),/COMMUNITY_CHECK_COMPLETE/)
})
