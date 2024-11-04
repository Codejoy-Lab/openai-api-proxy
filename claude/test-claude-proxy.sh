#!/bin/bash

# 默认API端点
CLAUDE_API_ENDPOINT=http://localhost:9000/v1
API_URL=${CLAUDE_API_ENDPOINT:-"https://api.anthropic.com/v1"}
API_ENDPOINT=$API_URL/messages

#导入$ANTHROPIC_API_KEY
source ./.env

# 检查API密钥是否设置
if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "请设置ANTHROPIC_API_KEY环境变量"
    exit 1
fi

# 发送请求到Claude API
response=$(curl -s "$API_ENDPOINT" \
     --header "x-api-key: $ANTHROPIC_API_KEY" \
     --header "anthropic-version: 2023-06-01" \
     --header "content-type: application/json" \
     --data '{
    "model": "claude-3-haiku-20240307",
    "max_tokens": 1024,
    "messages": [
        {"role": "user", "content": "You are an C# coding expert."},
        {"role": "user", "content": "Hello, world"}
    ]
}')


echo $response
# 从响应中提取消息内容
message=$(echo $response | jq -r '.content[0].text')

# 输出结果
echo "Claude响应:"
echo $message
