/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { expect, test } from "bun:test"
import { act } from "react"
import { createGitalsoInteractionSchema } from "./interaction.js"
import { GitalsoTui } from "./Tui.js"
test("GitAlso renders repository, commit and diff panels",async()=>{const x=await testRender(<GitalsoTui definition={{schema:createGitalsoInteractionSchema({repoPath:"D:/repo"},"zh"),run:async()=>({success:true,message:"状态",data:{repository:{root:"D:/repo",branch:"main",files:[],branches:[],commits:[],remotes:[],ahead:0,behind:0,stagedDiff:""},dinyInstalled:false,dinyVersion:null,commitMessage:null,committed:false,pushed:false,commitHash:null,errors:[]}})}} language="zh" onExit={()=>undefined}/>,{width:142,height:38,useMouse:true});try{await act(async()=>x.renderOnce());const f=x.captureCharFrame();expect(f).toContain("GITALSO // REPOSITORY DECK");expect(f).toContain("文件与暂存");expect(f).toContain("提交信息与分支");expect(f).toContain("Diff 与命令日志")}finally{await act(async()=>x.renderer.destroy())}})
