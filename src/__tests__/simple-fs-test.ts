import { SimpleFs } from "../simple-fs";
import path from "path";
import os from "os";

describe("SimpleFs", () => {
    const simpleFs = new SimpleFs();
    let tempDir: string;

    beforeEach(() => {
        tempDir = path.join(os.tmpdir(), `__simple-fs-test-dir__${Math.random()}`);
        simpleFs.deleteFolder(tempDir);
        simpleFs.createFolder(tempDir);
    });

    afterEach(() => {
        simpleFs.deleteFolder(tempDir);
    });

    describe("readFile", () => {
        test("non-existent file", () => {
            const fileName = "fake-file-that-does-not-exist.txt";
            expect(() => simpleFs.readFile(fileName)).toThrow(
                `ENOENT: no such file or directory, open '${fileName}`,
            );
        });

        test("directory fails", () => {
            expect(() => simpleFs.readFile(".")).toThrow(
                "EISDIR: illegal operation on a directory, read",
            );
        });

        test("real file", () => {
            const contentsString = simpleFs.readFile("package.json").toString();

            const contents = JSON.parse(contentsString) as Record<string, unknown>;

            // Make sure it's a non-trivial object so we're not just lucky that it read some file
            expect(Object.keys(contents).length).toBeGreaterThan(1);
        });
    });

    describe("writeFile", () => {
        test("writing to directory fails", () => {
            expect(() => simpleFs.writeFile(tempDir, "anything")).toThrow(
                `EISDIR: illegal operation on a directory, open '${tempDir}'`,
            );
        });

        test("writing and overwriting file", () => {
            const file = path.join(tempDir, "file.txt");
            const firstContents = "first contents";
            const secondContents = "second contents";

            simpleFs.writeFile(file, firstContents);
            expect(simpleFs.readFile(file).toString()).toEqual(firstContents);
            simpleFs.writeFile(file, secondContents);
            expect(simpleFs.readFile(file).toString()).toEqual(secondContents);
        });
    });

    describe("fileExists", () => {
        test("non-existent file", () => {
            expect(simpleFs.fileExists("fake-file")).toBe(false);
        });

        test("existent file", () => {
            const file = path.join(tempDir, "file.txt");
            simpleFs.writeFile(file, "contents");
            expect(simpleFs.fileExists(file)).toBe(true);
        });

        test("directory also exists", () => {
            const folder = path.join(tempDir, "folder");
            simpleFs.createFolder(folder);
            expect(simpleFs.fileExists(folder)).toBe(true);
        });
    });

    describe("listFiles", () => {
        test("non-existent directory", () => {
            const directory = "fake-directory-that-does-not-exist";
            expect(() => simpleFs.listFiles(directory)).toThrow(
                `ENOENT: no such file or directory, scandir '${directory}'`,
            );
        });

        test("file fails", () => {
            const fileName = "package.json";
            expect(() => simpleFs.listFiles(fileName)).toThrow(
                `ENOTDIR: not a directory, scandir '${fileName}'`,
            );
        });

        test("real directory", () => {
            const files = simpleFs.listFiles(".");

            // Make sure there are a good number of files (because of node_modules)
            expect(files.length).toBeGreaterThan(1000);

            expect(files.length).toEqual(new Set(files).size);

            expect(files).toEqual(
                expect.arrayContaining([
                    "package.json", // Root file
                    ".gitignore", // Hidden file
                    "src/index.ts", // In directory
                    "src/__tests__/simple-fs-test.ts", // Deep file in directory
                ]),
            );

            // Don't include folders, just files
            expect(files).not.toEqual(expect.arrayContaining(["src"]));
            expect(files).not.toEqual(expect.arrayContaining(["src/"]));
        });

        test("returns files that can be read", () => {
            for (const file of simpleFs.listFiles("src")) {
                expect(simpleFs.readFile(file)).toBeDefined();
            }
        });
    });

    describe("createFolder", () => {
        test("already is file", () => {
            const file = path.join(tempDir, "file.txt");
            simpleFs.writeFile(file, "contents");
            expect(() => simpleFs.createFolder(file)).toThrow(
                `EEXIST: file already exists, mkdir '${file}'`,
            );
        });

        test("already is folder does not throw", () => {
            const folder = path.join(tempDir, "folder");
            simpleFs.createFolder(folder);
            simpleFs.createFolder(folder);
        });

        test("create nested folder", () => {
            const folder = path.join(tempDir, "1", "2", "3", "folder");
            simpleFs.createFolder(folder);
        });
    });

    describe("deleteFolder", () => {
        test("non-existent file doesn't throw", () => {
            simpleFs.deleteFolder(path.join(tempDir, "non-existent-file.txt"));
        });

        test("deletes file", () => {
            const file = path.join(tempDir, "file.txt");
            const contents = "contents";
            simpleFs.writeFile(file, contents);
            expect(simpleFs.readFile(file).toString()).toEqual(contents);
            simpleFs.deleteFolder(file);
            expect(() => simpleFs.readFile(file).toString()).toThrow(
                `ENOENT: no such file or directory, open '${file}`,
            );
        });

        test("deletes folder and file", () => {
            const folder = path.join(tempDir, "folder");
            const file = path.join(folder, "file.txt");
            const contents = "contents";

            simpleFs.createFolder(folder);
            simpleFs.writeFile(file, contents);
            expect(simpleFs.readFile(file).toString()).toEqual(contents);
            simpleFs.deleteFolder(folder);
            expect(() => simpleFs.readFile(file).toString()).toThrow(
                `ENOENT: no such file or directory, open '${file}`,
            );
            expect(() => simpleFs.listFiles(folder).toString()).toThrow(
                `ENOENT: no such file or directory, scandir '${folder}`,
            );
        });
    });
});
