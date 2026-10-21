"use client";
import type {ReactNode} from "react";
import {useUiV2Mode} from "@/components/savant/ui-v2/mode";
import {EvaluationsScreen} from "./evaluations";
export function RunsFallback({children}:{children:ReactNode}){
 const enabled=useUiV2Mode();
 return enabled?<>{children}</>:<EvaluationsScreen/>;
}
