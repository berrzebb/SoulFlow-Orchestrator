/** OAuth 콜백 TCP 릴레이: 0.0.0.0:relayPort → 127.0.0.1:cliPort */
import { createServer, connect } from "net";
const [,, relayPort = "1456", cliPort = "1455"] = process.argv;
createServer(c => {
  const s = connect(+cliPort, "127.0.0.1");
  c.pipe(s); s.pipe(c);
  s.on("error", () => c.end());
  c.on("error", () => s.end());
}).listen(+relayPort, "0.0.0.0", () =>
  console.log(`relay 0.0.0.0:${relayPort} → 127.0.0.1:${cliPort}`),
);
