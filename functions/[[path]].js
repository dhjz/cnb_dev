export async function onRequest({ request, params, env }) {
  try {
    const { pathname: path, searchParams } = new URL(request.url)
    const rpath = params.path
    console.log('path:' + path)

    if (request.method == 'OPTIONS') {
      return new Response(null, { status: 200, headers: corsHeaders({ 'Access-Control-Max-Age': '86400' }) });
    }
    
    const targetUrl = searchParams.get('url') || searchParams.get('u') || searchParams.get('targetUrl')
    const debug = searchParams.get('debug')
    
    // let links = (await kv_cnb.get('links', {type: 'json'})) || {};
    let cnb_url = await kv_cnb.get('cnb_url')



    // const redirectMap = {
    //   '/proxy': 'https://home.199311.xyz:40003/proxy',
    //   '/tv': 'http://home.199311.xyz:44000/',
    // };
    // if (redirectMap[path]) { // 301重定向
    //   return Response.redirect(redirectMap[path], 301);
    // } 
    const val = searchParams.get('value') || searchParams.get('val') || searchParams.get('v')
    if (path == '/setUrl') { // 设置KV
      if (val) await kv_cnb.put('cnb_url', val)
      return new Response(`设置成功: ${key}, ${val}`, { headers: { 'Content-Type': 'text/plain; charset=UTF-8' } })
    } else if (path == '/getUrl') { // 获取KV值
      return new Response(await kv_cnb.get('cnb_url'), { headers: { 'Content-Type': 'text/plain; charset=UTF-8' } }) 
    }
    if (path == '/ip' || path == 'ip') { // 获取ip
      return new Response(request.eo?.clientIp || '');
    } else if (targetUrl) { // 代理地址
      return handleProxy(request, targetUrl, searchParams, request.method);
    } else if (cnb_url){ 
        return handleProxy(request, cnb_url + (path === '/' ? '' : path), searchParams, request.method);
    } else { // 默认首页
      // return Response.redirect('/index.html', 301);
      const html = `Hello World, 未配置cnb_url, ${JSON.stringify({path, targetUrl, debug})}`
      return new Response(html, { headers: { 'content-type': 'text/html; charset=UTF-8'}});
    }
  } catch (error) {
    return new Response(`Error handle functions: ${error.message}`, { status: 502, headers: corsHeaders() });
  }
}

async function handleProxy(request, targetUrl, searchParams, method) {
    const host = searchParams.get('host')
    const referer = searchParams.get('referer')
    const body = (method == 'GET' || method == 'HEAD') ? null : request.body; // GET 或 HEAD 请求，body 必须为 null
    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.delete('Accept-Encoding');
    host && headers.set('Host', host.trim());
    referer && headers.set('Referer', referer.trim());

    try {
      const res = await fetch(targetUrl, { method, headers, body}); // redirect: 'follow', // 自动处理重定向

      if (res.body instanceof ReadableStream) {
        const resHeaders = new Headers(res.headers)
        resHeaders.set('Cache-Control', 'no-store')
        return new Response(res.body, { status: res.status, headers: corsHeaders(resHeaders)});
      } else {
        corsHeaders(res.headers)
        return res;
      }
    } catch (e) {
      return new Response(`Error Proxy: ${e.message}`, { status: 502, headers: corsHeaders() });
    }
}

function corsHeaders(headers) {
  if (headers && headers instanceof Headers) {
    headers.set('Access-Control-Allow-Origin', '*')
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD')
    headers.set('Access-Control-Allow-Headers', '*')
    return headers
  } else {
    return {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD',
      'Access-Control-Allow-Headers': '*',
      ...(headers || {}),
      // 'Access-Control-Max-Age': '86400',
    }
  }
}