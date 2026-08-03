#!/usr/bin/env node
// Uso: node wa-send.js <numero> '<mensaje>'   (mensaje tambien por stdin)
// Envia WhatsApp via bridge Baileys de POWER-AGENT (127.0.0.1:3031). No imprime el token.
const fs=require("fs"),http=require("http"),os=require("os"),p=require("path");
const TOKEN=fs.readFileSync(p.join(os.homedir(),".claude","whatsapp-bridge",".auth-token"),"utf8").trim();
const num=(process.argv[2]||"").replace(/\D/g,"");
let msg=process.argv.slice(3).join(" ");
if(!msg){try{msg=fs.readFileSync(0,"utf8");}catch{}}
msg=msg.replace(/\s+$/,"");
if(!num||!msg){console.log("ERR faltan args: node wa-send.js <numero> '<mensaje>'");process.exit(1);}
const body=Buffer.from(JSON.stringify({to:num+"@c.us",message:msg}));
const r=http.request({host:"127.0.0.1",port:3031,method:"POST",path:"/send/text",
  headers:{"Content-Type":"application/json","Content-Length":body.length,"X-Auth-Token":TOKEN},timeout:15000},
  x=>{let d="";x.on("data",c=>d+=c);x.on("end",()=>console.log(x.statusCode,d));});
r.on("error",e=>console.log("ERR",e.message));
r.on("timeout",()=>{r.destroy();console.log("ERR timeout (bridge caido / POWER-AGENT cerrado?)");});
r.write(body);r.end();
