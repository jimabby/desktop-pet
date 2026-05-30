const { startControlServer } = require("./src/server");
const { execSync } = require("child_process");
const received = [];
const srv = startControlServer(7350, (s) => received.push(s));
setTimeout(() => {
  execSync(`curl -s localhost:7350/state -H 'Content-Type: application/json' -d '{"mood":"working","text":"Refactoring auth","source":"chatgpt","ttl":8000}' -o /dev/null`);
  execSync("PET_PORT=7350 node hooks/pet-notify.js happy 'all done!'");
  execSync(`echo '{"hook_event_name":"PreToolUse"}' | PET_PORT=7350 node hooks/pet-notify.js`);
  execSync(`echo '{"hook_event_name":"Stop"}' | PET_PORT=7350 node hooks/pet-notify.js`);
  const health = execSync("curl -s localhost:7350/health").toString();
  setTimeout(() => {
    console.log("HEALTH:", health);
    console.log("RECEIVED:\n" + JSON.stringify(received, null, 2));
    srv.close(); process.exit(0);
  }, 500);
}, 300);
