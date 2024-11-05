// 流式输出
const express = require('express')
const fetch = require('cross-fetch')
const app = express()
var multer = require('multer');
var forms = multer({limits: { fieldSize: 10*1024*1024 }});
app.use(forms.array());
const cors = require('cors');
app.use(cors());

const bodyParser = require('body-parser')
app.use(bodyParser.json({limit : '50mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

const controller = new AbortController();

app.all(`*`, async (req, res) => {

  if(req.originalUrl) req.url = req.originalUrl;
  const CLAUDE_API_BASE = process.env.CLAUDE_API_BASE || 'https://api.anthropic.com';
  let url = `${CLAUDE_API_BASE}${req.url}`;

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const timestamp = new Date().toLocaleString('zh-CN');

  // 从header中获取API key
  const api_key = req.headers['x-api-key'] || req.headers.authorization?.split(' ')[1];
  if(!api_key) return res.status(403).send('Forbidden');

  const proxy_key = req.headers['proxy-key'];
  if(process.env.PROXY_KEY && proxy_key !== process.env.PROXY_KEY)
    return res.status(403).send('Forbidden');

  const { moderation, moderation_level, ...restBody } = req.body;

  const options = {
    method: req.method,
    timeout: process.env.TIMEOUT || 30000,
    signal: controller.signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': api_key,
      'anthropic-version': '2023-06-01'
    }
  };

  if(req.method.toLowerCase() === 'post' && req.body) {
    // 转换消息格式
    if(req.url.includes('/messages')) {
      options.body = JSON.stringify({
        ...restBody,
        model: restBody.model || 'claude-3-sonnet-20240229',
        max_tokens: restBody.max_tokens || 1024
      });
    }
  }

  try {
    //console.log("Claude  API:请求Claude  API:", {url});
    console.log(`[${timestamp}]Claude  API: ${url} 请求IP：${ip} Model: ${restBody.model}`);
    // 处理流式请求
    if(restBody.stream) {
      const response = await myFetch(url, options);
      
      if(!response.ok) {
        const error = await response.json();
        return res.status(response.status).json(error);
      }
      console.log("使用SSE");
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
    
      // 直接转发Claude的响应流
      response.body.pipe(res);

      response.body.on('end', () => {
        res.end();
      });
      
      // 错误处理
      response.body.on('error', (err) => {
        console.error('Stream error:', err);
        res.end();
      });

    } else {
      // 处理普通请求
      const response = await myFetch(url, options);

      if(!response.ok) {
        const error = await response.json();
        return res.status(response.status).json(error);
      }

      const data = await response.json();

  /*       // 转换响应格式以匹配OpenAI格式
      if(req.url.includes('/messages')) {
*/ 
     const useOpenAIFormat = req.headers['x-use-openai-format'] === 'true'; 
      if(useOpenAIFormat && req.url.includes('/messages')) {
       const transformedData = {
          id: data.id,
          object: 'chat.completion',
          created: Date.now(),
          model: data.model,
          choices: [{
            index: 0,
            message: {
              role: "assistant",
              content: data.content[0].text
            },
            finish_reason: data.stop_reason
          }],
          usage: data.usage
        };
        return res.json(transformedData);
      }

      res.json(data);
    }

  } catch (error) {
    console.error("请求失败:", error);
    if (!res.headersSent) {
      res.status(500).json({"error": error.toString()});
    }
  }
});

async function myFetch(url, options) {
  const {timeout, ...fetchOptions} = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout||30000)
  const res = await fetch(url, {...fetchOptions, signal: controller.signal});
  clearTimeout(timeoutId);
  return res;
}

// Error handler
app.use(function(err, req, res, next) {
  console.error(err)
  if (!res.headersSent) {
    res.status(500).send('Internal Serverless Error')
  }
})

const port = process.env.PORT || 9000;
app.listen(port, () => {
  console.log(`Server start on http://localhost:${port}`);
})
