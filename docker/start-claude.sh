IMAGE=docker-registry.codejoyai.com:8000/openai-proxy/claude:latest
PORT=8002
docker run -d  -p 8002:9000 $IMAGE
