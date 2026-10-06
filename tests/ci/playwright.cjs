// CI only (see .github/workflows/tests.yml): GitHub's runners have no GPU, and Chromium's default
// software WebGL draws the office at about one frame per second. Run headed under Xvfb on Mesa's
// multi-threaded llvmpipe instead, which is several times faster. Tests load this file through
// PLAYWRIGHT_MODULE, so they stay unchanged.
const playwright = require('playwright');
const launch = playwright.chromium.launch.bind(playwright.chromium);
playwright.chromium.launch = (options = {}) => launch({...options, headless: false, args: [...(options.args || []), '--use-angle=gl', '--ignore-gpu-blocklist']});
module.exports = playwright;
