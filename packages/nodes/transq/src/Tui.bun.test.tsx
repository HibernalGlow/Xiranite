/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { expect, test } from "bun:test"
import { act } from "react"
import { createTransqInteractionSchema } from "./interaction.js"
import { TransqTui } from "./Tui.js"
test("TransQ renders four queue lanes and execution gate",async()=>{const setup=await testRender(<TransqTui definition={{schema:createTransqInteractionSchema({paths:"D:/translation/project"},"zh"),run:async()=>({success:true,message:"完成",data:{items:[{id:"a",originalImagesPath:"D:/translation/project/original_images",resultPath:"D:/translation/project/original_images/manga_translator_work/result",outputPath:"D:/translation/project/result",status:"pending",originalCount:2,resultCount:1,missingFiles:["002.png"],extraFiles:[],copies:[],cleanupPaths:[],errors:[]}],pendingCount:1,readyCount:0,outputCount:0,conflictCount:0,copiedFiles:0,deletedOriginals:0,deletedWorkItems:0,errors:[]}})}} language="zh" onExit={()=>undefined}/>,{width:142,height:38,useMouse:true});try{await act(async()=>setup.renderOnce());const frame=setup.captureCharFrame();expect(frame).toContain("TRANSQ // QUEUE BOARD");expect(frame).toContain("待补齐");expect(frame).toContain("可整理");expect(frame).toContain("冲突")}finally{await act(async()=>setup.renderer.destroy())}})
