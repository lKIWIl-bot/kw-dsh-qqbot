import https from 'node:https';
import net from 'node:net';

// Proxy Fake-IP pools are not usable destination addresses. Resolve the domain
// separately through authenticated HTTPS; never permit these IPs as targets.
export function isProxyDnsAddress(address) {
 const ip=String(address).toLowerCase();
 if(net.isIP(ip)===4){const p=ip.split('.').map(Number);return p[0]===198&&(p[1]===18||p[1]===19);}
 return net.isIP(ip)===6&&new URL('http://['+ip+']/').hostname.slice(1,-1).startsWith('2001:2:');
}
const cache=new Map();
function query(host,type){
 return new Promise((resolve,reject)=>{
  let req,res,settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);if(error){reject(error);req?.destroy();res?.destroy();}else resolve(value);};
  const timer=setTimeout(()=>finish(Error('公共DNS解析超时')),5000);
  try{
   req=https.request({hostname:'1.1.1.1',port:443,servername:'cloudflare-dns.com',rejectUnauthorized:true,method:'GET',path:'/dns-query?name='+encodeURIComponent(host)+'&type='+type,headers:{host:'cloudflare-dns.com',accept:'application/dns-json'}},response=>{
    res=response;res.on('error',e=>finish(e));res.on('aborted',()=>finish(Error('公共DNS响应中断')));
    if(res.statusCode!==200){finish(Error('公共DNS HTTP '+res.statusCode));return;}
    let size=0;const chunks=[];
    res.on('data',chunk=>{size+=chunk.length;if(size>65536){finish(Error('公共DNS响应超限'));return;}chunks.push(chunk);});
    res.on('end',()=>{
     if(settled)return;
     try{
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(body.Status!==0||body.TC===true)throw Error('公共DNS无有效解析结果');
      const question=body.Question?.[0];
      if(question?.type!==type||String(question?.name).toLowerCase().replace(/\.$/,'')!==host)throw Error('公共DNS问题不匹配');
      const answers=(body.Answer??[]).filter(a=>a.type===type);
      if(answers.length>32)throw Error('公共DNS记录过多');
      const addresses=answers.map(a=>({address:String(a.data),family:type===1?4:6,ttl:Number(a.TTL)}));
      if(addresses.some(a=>net.isIP(a.address)!==a.family))throw Error('公共DNS地址无效');
      finish(null,addresses);
     }catch(e){finish(e);}
    });
   });
   req.on('error',e=>finish(e));req.end();
  }catch(e){finish(e);}
 });
}
export async function resolvePublicDns(host){
 const hit=cache.get(host);if(hit&&hit.until>Date.now())return hit.addresses;
 const addresses=(await Promise.all([query(host,1),query(host,28)])).flat();
 if(!addresses.length)throw Error('公共DNS没有地址记录');
 const ttl=Math.min(300,...addresses.map(a=>Number.isFinite(a.ttl)&&a.ttl>0?a.ttl:30));
 const value=addresses.map(({address,family})=>({address,family}));
 cache.set(host,{addresses:value,until:Date.now()+ttl*1000});
 while(cache.size>128)cache.delete(cache.keys().next().value);
 return value;
}
