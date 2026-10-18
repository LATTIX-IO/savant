import { posix, win32 } from "node:path";

/** Match the invoked entry script to this module's actual filesystem path.
 * Node uses backslashes for process.argv[1] on Windows. A slash-suffix
 * check silently skips the entire command, including an explicit --apply.
 */
export function isDirectCliInvocation(argvPath, moduleFilename, platform=process.platform){
  if(typeof argvPath!=="string"||argvPath.length===0||
     typeof moduleFilename!=="string"||moduleFilename.length===0)
    return false;
  const paths=platform==="win32"?win32:posix;
  const invocation=paths.resolve(argvPath), module=paths.resolve(moduleFilename);
  return platform==="win32"?
    invocation.toLowerCase()===module.toLowerCase():invocation===module;
}
