/** Package-manager output and subprocess lifetime stay separate from the SDK transport. */
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {createServer} from 'node:net'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {runPackageOperation} from '../runtime/package-operation.ts'
import {AgentConfiguration} from '../runtime/agent-configuration.ts'
import {availableBundledRuntime,bundledPi} from '../runtime/bundled.ts'
import {resolveProviderRuntime} from '../bridge/provider-runtime.ts'

test('native package jobs isolate noisy package-manager output and cancel their process tree', {timeout:60_000}, async context=>{
  const bundled=await availableBundledRuntime(resolve('apps/pi-dsh'),process.env.PI_DSH_TEST_RUNTIME)
  if(!bundled){context.skip('Prepare the selected native Pi runtime');return}
  const root=await mkdtemp(join(tmpdir(),'pi-package-operation-'))
  context.after(async()=>{await rm(root,{recursive:true,force:true})})
  const agentDir=join(root,'agent'),cwd=join(root,'project');await Promise.all([mkdir(agentDir),mkdir(cwd)])
  const selected=await resolveProviderRuntime({...bundledPi(bundled),agentDir})
  const configuration={sdkEntry:selected.sdkEntry,cwd,agentDir}
  const stub=join(root,'npm.cjs')
  // A local package-manager executable exercises Pi's public npmCommand and stdout inheritance without registry access.
  await writeFile(stub,`const fs=require('node:fs'),path=require('node:path');console.log('unframed package manager output');const args=process.argv.slice(2),root=args[args.indexOf('--prefix')+1],dir=path.join(root,'node_modules','desktop-test-package');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name:'desktop-test-package',version:'1.0.0',pi:{extensions:['./index.js']}}));fs.writeFileSync(path.join(dir,'index.js'),'export default function(){}');`)
  await writeFile(join(agentDir,'settings.json'),JSON.stringify({npmCommand:[process.execPath,stub],retained:true}))
  await runPackageOperation(configuration,{action:'package',operation:'install',scope:'user',source:'npm:desktop-test-package@1.0.0'},new AbortController().signal)
  const config=new AgentConfiguration(await import(selected.sdkEntry),cwd,agentDir)
  const installed=await config.view();assert.equal(installed.packages[0]?.name,'desktop-test-package')
  assert.equal(JSON.parse(await readFile(join(agentDir,'settings.json'),'utf8')).retained,true)
  const sockets=new Set<import('node:net').Socket>()
  let started!:()=>void, disconnected!:()=>void
  const ready=new Promise<void>(done=>{started=done}),gone=new Promise<void>(done=>{disconnected=done})
  const server=createServer(socket=>{sockets.add(socket);if(sockets.size===2)started();socket.on('close',()=>{sockets.delete(socket);if(sockets.size===0)disconnected()})})
  await new Promise<void>((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done)})
  context.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise<void>(done=>{server.close(()=>{done()})})})
  const address=server.address();assert.ok(address&&typeof address!=='string')
  const childScript=`require('node:net').connect(${address.port},'127.0.0.1');process.on('SIGTERM',()=>{});setInterval(()=>{},1000)`
  await writeFile(stub,`require('node:net').connect(${address.port},'127.0.0.1');require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(childScript)}],{stdio:'ignore'});setInterval(()=>{},1000)`)
  const abort=new AbortController()
  context.after(()=>{abort.abort()})
  const operation=runPackageOperation(configuration,{action:'package',operation:'install',scope:'user',source:'npm:desktop-test-package@1.0.0'},abort.signal)
  const cancelled=assert.rejects(operation,/cancelled/)
  await ready;abort.abort();await cancelled;await gone
})

test('Host close cancels a package job before awaiting its management queue', {timeout:60_000}, async context=>{
  const {build}=await import('esbuild')
  const {startHost}=await import('../server.ts')
  const bundled=await availableBundledRuntime(resolve('apps/pi-dsh'),process.env.PI_DSH_TEST_RUNTIME)
  if(!bundled){context.skip('Prepare the selected native Pi runtime');return}
  const root=await mkdtemp(join(tmpdir(),'pi-package-host-')),agentDir=join(root,'agent'),appRoot=join(root,'app')
  context.after(async()=>{await rm(root,{recursive:true,force:true})})
  await Promise.all([mkdir(agentDir),mkdir(join(appRoot,'runtime'),{recursive:true})])
  let started!:()=>void,disconnected!:()=>void
  const ready=new Promise<void>(done=>{started=done}),gone=new Promise<void>(done=>{disconnected=done})
  const sockets=new Set<import('node:net').Socket>()
  const listener=createServer(socket=>{sockets.add(socket);started();socket.once('close',()=>{sockets.delete(socket);disconnected()})})
  await new Promise<void>(done=>listener.listen(0,'127.0.0.1',done))
  context.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise<void>(done=>listener.close(()=>done()))})
  const address=listener.address();assert.ok(address&&typeof address!=='string')
  const npm=join(root,'npm.cjs');await writeFile(npm,`require('node:net').connect(${address.port},'127.0.0.1');setInterval(()=>{},1000)`)
  await writeFile(join(agentDir,'settings.json'),JSON.stringify({npmCommand:[process.execPath,npm]}))
  await writeFile(join(appRoot,'runtime','selected.json'),JSON.stringify({...bundledPi(bundled),agentDir}))
  await build({entryPoints:[resolve('apps/pi-dsh/runtime/provider-worker.ts'),resolve('apps/pi-dsh/runtime/package-worker.ts')],outdir:root,outExtension:{'.js':'.mjs'},bundle:true,platform:'node',format:'esm',packages:'external'})
  const host=await startHost({port:0,home:join(root,'desktop'),appRoot,providerWorker:join(root,'provider-worker.mjs')})
  let closed=false;context.after(async()=>{if(!closed)await host.close()})
  const installation=fetch(host.url+'/api/agent-configuration',{method:'POST',headers:{'content-type':'application/json',origin:host.url},body:JSON.stringify({action:'package',operation:'install',scope:'user',source:'npm:host-fixture@1.0.0'})})
  await ready;assert.equal(host.hasActiveTasks(),true)
  const shutdown=host.close();const response=await installation;assert.equal(response.ok,false)
  await shutdown;closed=true;await gone
})
