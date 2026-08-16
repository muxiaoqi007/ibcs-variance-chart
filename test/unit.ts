// Unit suite entry: jsdom globals + mocha (browser build bundled by webpack).

import { installGlobals } from "./harness";

installGlobals();

// The browser build attaches `mocha`, `describe`, `it` etc. to the global
// object; under node it needs window.location and document from jsdom.
require("mocha/mocha.js");

interface BrowserMocha {
    setup: (options: unknown) => void;
    run: (onDone: (failures: number) => void) => unknown;
}

const mocha = (globalThis as { mocha?: BrowserMocha }).mocha;
if (!mocha) {
    console.error("mocha browser build failed to attach globals");
    process.exit(1);
}

mocha.setup({ ui: "bdd", reporter: "spec", timeout: 5000 });

require("./unit.spec");

mocha.run((failures: number) => {
    console.log(failures === 0 ? "\nALL UNIT TESTS PASSED" : `\n${failures} UNIT TEST(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
});
