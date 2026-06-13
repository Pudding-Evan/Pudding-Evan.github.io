import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { syncBuiltinESMExports } from "node:module";

const originalExec = childProcess.exec;

childProcess.exec = function exec(command, options, callback) {
  if (command === "net use") {
    const done = typeof options === "function" ? options : callback;
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;

    queueMicrotask(() => {
      child.stdout.end();
      child.stderr.end();
      done?.(null, "", "");
      child.emit("exit", 0, null);
      child.emit("close", 0, null);
    });

    return child;
  }

  return originalExec.apply(this, arguments);
};

syncBuiltinESMExports();
