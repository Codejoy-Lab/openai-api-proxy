#!/bin/bash

# 默认API端点
CLAUDE_API_ENDPOINT=http://localhost:9000/v1
API_URL=${CLAUDE_API_ENDPOINT:-"https://api.anthropic.com/v1"}
API_ENDPOINT=$API_URL/messages


# ANTHROPIC_API_KEY 读取
source ./.env


# 检查API密钥是否设置
if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "请设置ANTHROPIC_API_KEY环境变量"
    exit 1
fi

curl -sN "$API_ENDPOINT" \
     -H "x-api-key: $ANTHROPIC_API_KEY" \
     -H "anthropic-version: 2023-06-01" \
     -H "content-type: application/json" \
     -d '{
    "model": "claude-3-haiku-20240307",
    "max_tokens": 1024,
    "stream": true,
    "messages": [
        {"role": "user", "content": "You are an C# coding expert."},
        {"role": "user", "content": "Hello, world"}
    ]
}' | while IFS= read -r line; do
    # 跳过空行
    [ -z "$line" ] && continue
    
    # 显示原始数据（调试用）
    # echo "DEBUG: Received line: $line"
    
    # 检查是否是数据行
    if [[ $line == data:* ]]; then
        # 提取 "data:" 后的 JSON
        data="${line#data: }"
        
        # 如果是 [DONE] 则结束
        if [ "$data" = "[DONE]" ]; then
            echo "传输完成"
            break
        fi
        
        # 尝试解析 JSON 并提取文本
        if [ ! -z "$data" ]; then
            echo "$data" | jq -r 'if .delta and .delta.text then .delta.text else empty end' 2>/dev/null
        fi
    fi
done
