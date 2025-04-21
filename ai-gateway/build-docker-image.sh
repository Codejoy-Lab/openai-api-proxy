#!/bin/bash
PROJ="codejoy-openai-proxy"
VER="1.0"
echo "Building Docker image: $PROJ:$VER"
docker build --no-cache -t $PROJ:$VER .