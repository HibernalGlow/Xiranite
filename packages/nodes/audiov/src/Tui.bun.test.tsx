/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { expect,test } from "bun:test"
import { act } from "react"
import { createAudiovInteractionSchema } from "./interaction.js"
import { AudiovTui } from "./Tui.js"
test("AudioV renders queue, ffmpeg plan and output panels",async()=>{const x=await testRender(<AudiovTui definition={{schema:createAudiovInteractionSchema({paths:"D:/video/demo.mp4"},"zh"),run:async()=>({success:true,message:"计划",data:{commands:[],commandResults:[],selectedPaths:[],outputPaths:[],errors:[]}})}} language="zh" onExit={()=>undefined}/>,{width:142,height:38,useMouse:true});try{await act(async()=>x.renderOnce());const f=x.captureCharFrame();expect(f).toContain("AUDIOV // EXTRACTION DECK");expect(f).toContain("视频队列");expect(f).toContain("ffmpeg 计划");expect(f).toContain("输出与日志")}finally{await act(async()=>x.renderer.destroy())}})
