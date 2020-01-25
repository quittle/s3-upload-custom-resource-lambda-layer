import { SimpleFs } from "../simple-fs";

describe("SimpleFs", () => {
    const simpleFs = new SimpleFs();

    describe("readFile", () => {
        test("non-existent file", () => {
            const fileName = "fake-file-that-does-not-exist.txt";
            expect(() => simpleFs.readFile(fileName)).toThrowError(`ENOENT: no such file or directory, open '${fileName}`);
        });

        test("directory fails", () => {
            expect(() => simpleFs.readFile(".")).toThrowError("EISDIR: illegal operation on a directory, read");
        });

        test("real file", () => {
            const contentsString = simpleFs.readFile("package.json").toString();

            const contents: object = JSON.parse(contentsString);

            // Make sure it's a non-trivial object so we're not just lucky that it read some file
            expect(Object.keys(contents).length).toBeGreaterThan(1);
        });
    });

    describe("listFiles", () => {
        test("non-existent directory", () => {
            const directory = "fake-directory-that-does-not-exist";
            expect(() => simpleFs.listFiles(directory)).toThrowError(`ENOENT: no such file or directory, scandir '${directory}'`);
        });

        test("file fails", () => {
            const fileName = "package.json";
            expect(() => simpleFs.listFiles(fileName)).toThrowError(`ENOTDIR: not a directory, scandir '${fileName}'`);
        });

        test("real directory", () => {
            const files = simpleFs.listFiles(".");

            // Make sure there are a good number of files (because of node_modules)
            expect(files.length).toBeGreaterThan(1000);

            expect(files.length).toEqual(new Set(files).size);

            expect(files).toEqual(expect.arrayContaining([
                "package.json", // Root file
                ".gitignore", // Hidden file
                "src/index.ts", // In directory
                "src/__tests__/simple-fs-test.ts", // Deep file in directory
            ]));

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
})
