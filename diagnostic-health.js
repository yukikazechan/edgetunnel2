export default {
  async fetch(request, env) {
    const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
    if (new URL(request.url).pathname !== "/runtime") return new Response(JSON.stringify({ok:true,probe:"standalone-health"}), {headers});
    try {
      const digest = await crypto.subtle.digest("MD5", new TextEncoder().encode("standalone-health"));
      return new Response(JSON.stringify({ok:true,hasCf:!!request.cf,hasKv:!!env.KV,kvGet:typeof env.KV?.get,md5Bytes:digest.byteLength}), {headers});
    } catch(error) {
      return new Response(JSON.stringify({ok:false,name:error.name,message:error.message}), {status:500,headers});
    }
  }
};
