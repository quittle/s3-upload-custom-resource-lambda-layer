import * as fs from "fs";
import * as path from "path";

export class SimpleFs {
    public listFiles(root: string): string[] {
        const dirs = fs.readdirSync(root, { withFileTypes: true });
        let ret: string[] = [];
        for (const f of dirs) {
            const filePath = path.join(root, f.name);
            if (f.isDirectory()) {
                ret = ret.concat(this.listFiles(filePath));
            } else if (f.isFile()) {
                ret.push(filePath);
            }
        }
        return ret;
    }

    public fileExists(file: string): boolean {
        return fs.existsSync(file);
    }

    public readFile(file: string): Buffer {
        return fs.readFileSync(file);
    }

    public writeFile(file: string, contents: string): void {
        fs.writeFileSync(file, contents);
    }

    public createFolder(folder: string): void {
        fs.mkdirSync(folder, { recursive: true });
    }

    public deleteFolder(root: string): void {
        fs.rmdirSync(root, { recursive: true });
    }
}
