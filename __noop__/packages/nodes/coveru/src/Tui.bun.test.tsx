/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { expect,test } from "bun:test"
import { act } from "react"
import { createCoveruInteractionSchema } from "./interaction.js"
import { CoveruTui } from "./Tui.js"
test("CoverU renders candidate review panels",async()=>{const x=await testRender(<CoveruTui definition={{schema:createCoveruInteractionSchema({paths:"D:/books/a.cbz"},"zh"),run:async()=>({success:true,message:"计划",data:{candidates:[],archiveCount:0,readyCount:0,extractedCount:0,skippedCount:0,errorCount:0,unsupportedCount:0,errors:[]}})}} language="zh" onExit={()=>undefined}/>,{width:142,height:38,useMouse:true});try{await act(async()=>x.renderOnce());const f=x.captureCharFrame();expect(f).toContain("COVERU // COVER SCANNER");expect(f).toContain("候选封面");expect(f).toContain("提取状态")}finally{await act(async()=>x.renderer.destroy())}})
