import fs from "fs";
import path from "path";

export class FsProxy {
  private files: { [path: string]: string } = {};
  readFileSync(path: string, options: any) {
    if (path in this.files) {
      return this.files[path];
    }
    return fs.readFileSync(path, { encoding: "utf-8" }) as string;
  }
  existsSync(path: string) {
    return path in this.files || fs.existsSync(path);
  }

  accept(p: string, body: string, base: string) {
    if (!path.isAbsolute(p)) {
      this.files[p] = body;
      return;
    }
    this.files[path.join(base, p)] = body;
  }

  private constructor() {}
  public static instance = new FsProxy();
}
