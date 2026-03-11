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
      return new Response(`设置成功: 'cnb_url', ${val}`, { headers: { 'Content-Type': 'text/plain; charset=UTF-8' } })
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
    const host = searchParams.get('host');
    const referer = searchParams.get('referer');
    const body = (method === 'GET' || method === 'HEAD') ? null : request.body;
    const headers = new Headers(request.headers);
    
    headers.delete('host');
    // 【关键1】明确告知上游：不压缩，并且期望接收 SSE 流
    headers.set('Accept-Encoding', 'identity');
    headers.set('Accept', 'text/event-stream'); 
    
    host && headers.set('Host', host.trim());
    referer && headers.set('Referer', referer.trim());

    try {
      const res = await fetch(targetUrl, { method, headers, body });

      // 判断是否为流式响应
      const contentType = res.headers.get('content-type') || '';
      const isStream = contentType.includes('text/event-stream') || contentType.includes('application/stream+json');

      if (isStream && res.body) {
        const resHeaders = new Headers(res.headers);
        resHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        resHeaders.set('Connection', 'keep-alive');
        resHeaders.set('X-Accel-Buffering', 'no');
        resHeaders.delete('Content-Encoding');
        resHeaders.delete('Content-Length');

        // 【关键2】使用手动泵 (Manual Pumping) 替代 pipeTo
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const reader = res.body.getReader();

        // 异步执行读写循环，不阻塞当前响应返回
        (async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                await writer.close();
                break;
              }
              // 读到一个 chunk，立刻写入客户端
              await writer.write(value);
            }
          } catch (err) {
            console.error('Stream processing error:', err);
            await writer.abort(err);
          }
        })();

        return new Response(readable, { 
            status: res.status, 
            headers: corsHeaders(resHeaders) 
        });
        
      } else {
        const resHeaders = new Headers(res.headers);
        return new Response(res.body, { 
            status: res.status, 
            headers: corsHeaders(resHeaders) 
        });
      }
    } catch (e) {
      return new Response(`Error Proxy: ${e.message}`, { status: 502, headers: corsHeaders(new Headers()) });
    }
}

async function handleProxyOld1(request, targetUrl, searchParams, method) {
    const host = searchParams.get('host')
    const referer = searchParams.get('referer')
    const body = (method == 'GET' || method == 'HEAD') ? null : request.body; 
    const headers = new Headers(request.headers);
    
    headers.delete('host');
    // 【关键1】明确告诉目标服务器：不要压缩！压缩会导致必须缓冲一定量才能解压
    headers.set('Accept-Encoding', 'identity'); 
    
    host && headers.set('Host', host.trim());
    referer && headers.set('Referer', referer.trim());

    try {
      const res = await fetch(targetUrl, { method, headers, body}); 

      // 判断是否为流式响应 (OpenAPI 流式标准格式为 text/event-stream)
      const contentType = res.headers.get('content-type') || '';
      const isStream = contentType.includes('text/event-stream') || res.body instanceof ReadableStream;

      if (isStream && res.body) {
        const resHeaders = new Headers(res.headers);
        
        // 【关键2】设置严格的防缓冲、防缓存响应头
        resHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        resHeaders.set('Connection', 'keep-alive');
        resHeaders.set('X-Accel-Buffering', 'no'); // 告诉 Nginx/CDN 等反向代理不要缓冲
        resHeaders.delete('Content-Encoding'); // 确保发给客户端的数据没有标记为压缩
        resHeaders.delete('Content-Length'); // 流式传输不应该有固定长度

        // 【关键3】使用 TransformStream 强制按块透传
        // 直接传递 res.body 有时仍会被底层 JS 引擎隐式缓冲，使用 TransformStream 可以强制即时刷出
        const { readable, writable } = new TransformStream();
        res.body.pipeTo(writable).catch(err => console.error('Stream pipe error:', err));

        // 假设 corsHeaders 会修改并返回 Headers 对象
        return new Response(readable, { 
            status: res.status, 
            headers: corsHeaders(resHeaders) 
        });
        
      } else {
        const resHeaders = new Headers(res.headers);
        return new Response(res.body, { 
            status: res.status, 
            headers: corsHeaders(resHeaders) 
        });
      }
    } catch (e) {
      return new Response(`Error Proxy: ${e.message}`, { status: 502, headers: corsHeaders(new Headers()) });
    }
}

async function handleProxyOld(request, targetUrl, searchParams, method) {
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