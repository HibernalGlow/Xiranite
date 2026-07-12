/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { expect,test } from "bun:test"
import { act } from "react"
import { createJellyPotInteractionSchema } from "./interaction.js"
import { JellyPotTui } from "./Tui.js"
test("JellyPot renders media bridge panels",async()=>{const x=await testRender(<JellyPotTui definition={{schema:createJellyPotInteractionSchema({},"zh"),run:async()=>({success:true,message:"ready",data:{checks:[],normalizedMediaPath:"",commands:[],commandResults:[],errors:[]}})}} language="zh" onExit={()=>undefined}/>,{width:142,height:38,useMouse:true});try{await act(async()=>x.renderOnce());const f=x.captureCharFrame();expect(f).toContain("JELLYPOT // MEDIA BRIDGE");expect(f).toContain("启动控制台");expect(f).toContain("依赖矩阵");expect(f).toContain("命令与日志")}finally{await act(async()=>x.renderer.destroy())}})
