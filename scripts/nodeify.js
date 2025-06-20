const fs = require('fs').promises;
const path = require('path');

async function nodeify() {
  try {
    // Read source from local file
    const sourcePath = path.join(__dirname, 'headless-min.js');
    let source = await fs.readFile(sourcePath, 'utf8');

    // Extract hash from source header comment
    const hashMatch = source.match(/\/\*[\s\S]*?(\b[a-f0-9]{8}\b)/);
    const hash = hashMatch?.[1] || 'unknown';

    // Process source code
    source = processSource(source);

    // Write output
    const outputPath = path.join(__dirname, '../src/build.js');
    await writeOutputFile(outputPath, source);

    console.log(`SUCCESS:${hash}`); // Special format for GitHub Actions
    return hash;
  } catch (error) {
    console.error(`ERROR:${error.message}`);
    process.exit(1);
  }
}

function processSource(source) {
  // Remove window references
  source = removeWindowReferences(source);

  // Apply regex replacements
  source = applyRegexReplacements(source);

  // Add proxy support
  source = addProxySupport(source);

  // Wrap with module code
  return wrapWithModuleCode(source);
}

function removeWindowReferences(source) {
  const replacements = {
    'window.': '',
    'parent.': '',
    'document.': '',
    '.innerHTML': '',
    'getElementById("roomlink")': 'null',
    'getElementById("recaptcha")': 'null',
  };

  return Object.entries(replacements).reduce(
    (text, [search, replace]) => text.replaceAll(search, replace),
    source
  );
}

function applyRegexReplacements(source) {
  // HBInit replacement - flexible with whitespace
  const hbInitMatch = source.match(/HBInit\s*=\s*.+?;/);
  if (!hbInitMatch) throw new Error('Failed to find HBInit pattern');
  const assignmentValue = hbInitMatch[0].match(/=\s*(.+?);/)[1];
  source = source.replace(
    hbInitMatch[0],
    `promiseResolve(${assignmentValue});`
  );

  // WebSocket replacement - flexible with whitespace
  const wsMatch = source.match(/new\s+WebSocket\s*\([^)]+\)\s*;?/);
  if (!wsMatch) throw new Error('Failed to find WebSocket pattern');
  source = source.replace(
    wsMatch[0],
    wsMatch[0].replace(
      /new\s+WebSocket\s*\(([^)]+)\)/,
      'new WebSocket($1, {headers:{origin: "https://html5.haxball.com"}, agent: proxyAgent})'
    )
  );

  // Add WebSocket error debug - very flexible with whitespace
  const wsErrorPattern =
    /([a-zA-Z]+)\.([a-zA-Z]+)\.onerror\s*=\s*function\s*\(\s*\)\s*{\s*([a-zA-Z]+)\.([a-zA-Z]+)\s*\(\s*(!0|true)\s*\)\s*}\s*;?/;
  const wsErrorMatch = source.match(wsErrorPattern);
  if (!wsErrorMatch) throw new Error('Failed to find WebSocket error handler');

  const [fullMatch, objName, wsProperty, methodObj, methodName, trueValue] = wsErrorMatch;
  const debugCode = `${objName}.${wsProperty}.onerror=function(err){${methodObj}.${methodName}(${trueValue});debug && console.error(err)};`;
  source = source.replace(fullMatch, debugCode);

  // Recaptcha replacement - flexible with whitespace
  const recaptchaMatch = source.match(
    /case\s+"recaptcha"\s*:\s*([a-zA-Z]+)\s*\(\s*([^)]+)\s*\)/
  );
  if (!recaptchaMatch) throw new Error('Failed to find Recaptcha pattern');
  source = source.replace(
    recaptchaMatch[0],
    'case "recaptcha":console.log(new Error("Invalid Token Provided!"))'
  );

  return source;
}

function addProxySupport(source) {
  // Find the initialization pattern with flexible whitespace matching
  const initPattern =
    /if\s*\(\s*[A-Za-z]+\.[A-Za-z]+\s*\)\s*throw\s+[A-Za-z]+\.[A-Za-z]+\s*\(\s*"Can't init twice"\s*\)\s*;\s*[A-Za-z]+\.[A-Za-z]+\s*=\s*!0\s*;/;
  const initMatch = source.match(initPattern);

  if (!initMatch) {
    throw new Error('Could not find initialization pattern for proxy support');
  }

  // Get the RoomConfigLookup function name - flexible with whitespace
  const configLookupMatch = source.match(/(\w+)\s*\(\s*"noPlayer"\s*,/);
  if (!configLookupMatch) {
    throw new Error('Could not find RoomConfigLookup function');
  }
  const configFn = configLookupMatch[1];

  // Add proxy support code after initialization
  const proxyCode = `${initMatch[0].slice(
    0,
    -3
  )}!0;proxyAgent = ${configFn}("proxy", null) ? new HttpsProxyAgent(url.parse(${configFn}("proxy", null))) : null; debug = ${configFn}("debug", null) == true;`;

  // Replace the entire initialization block
  source = source.replace(initMatch[0], proxyCode);

  return source;
}

function wrapWithModuleCode(source) {
  const header = `const WebSocket = require("ws");
const XMLHttpRequest = require("xhr2");
const JSON5 = require("json5");
const url = require("url");
const pako = require("pako");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { Crypto } = require("@peculiar/webcrypto");
const { performance } = require("perf_hooks");
const crypto = new Crypto();

let { RTCPeerConnection, RTCIceCandidate, RTCSessionDescription } = require("@mertushka/node-datachannel/polyfill");

var promiseResolve;
var proxyAgent;
var debug = false;

const HBLoaded = (config) => {
  if(config?.webrtc) {
    RTCPeerConnection = config.webrtc.RTCPeerConnection;
    RTCIceCandidate = config.webrtc.RTCIceCandidate;
    RTCSessionDescription = config.webrtc.RTCSessionDescription;
  }
  return new Promise(function (resolve, reject) {
  promiseResolve = resolve;
  });
}

const onHBLoaded = function (cb) {
  return cb;
};

/* Builded & Automated with Haxball.JS Nodeify Script - Reads from local headless-min.js file */

`;

  const footer = `\nmodule.exports = HBLoaded;`;

  return header + source + footer;
}

async function writeOutputFile(outputPath, content) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, content, 'utf8');
}

nodeify();
