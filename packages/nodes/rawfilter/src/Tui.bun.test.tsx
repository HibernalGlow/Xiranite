/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { expect,test } from "bun:test"
import { act } from "react"
import { createRawfilterInteractionSchema } from "./interaction.js"
import { RawfilterTui } from "./Tui.js"
test("Rawfilter renders groups, plan and statistics",async()=>{const x=await testRender(<RawfilterTui definition={{schema:createRawfilterInteractionSchema({path:"D:/archives"},"zh"),run:async()=>({success:true,message:"计划",data:{archiveCount:0,totalGroups:0,duplicateGroups:0,skippedFiles:0,movedToTrash:0,movedToMulti:0,createdShortcuts:0,keptCount:0,errorCount:0,plan:[],groups:[],errors:[]}})}} language="zh" onExit={()=>undefined}/>,{width:142,height:38,useMouse:true});try{await act(async()=>x.renderOnce());const f=x.captureCharFrame();expect(f).toContain("RAWFILTER // ARCHIVE SORTER");expect(f).toContain("归档分组");expect(f).toContain("整理计划");expect(f).toContain("统计与日志")}finally{await act(async()=>x.renderer.destroy())}})
