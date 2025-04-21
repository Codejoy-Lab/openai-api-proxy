#!/bin/bash

echo "For Simplicity"
echo "USE crontab -e"
echo 3 4 * * 6 /bin/bash /proj/claude-proxy/ai-gateway/acme-update-hook.sh  >> /var/log/acme_renew_hook.log 2>&1

# --- 配置 ---
# Docker Compose 项目文件所在的目录
COMPOSE_PROJECT_DIR=$PWD # Project path for AI Gateway
# 使用的 Docker Compose 命令 (推荐 V2: 'docker compose', 旧版 V1: 'docker-compose')
DOCKER_COMPOSE_CMD="docker compose" # Verify this matches your installed version
# 日志文件路径 (可选，用于记录 Hook 执行情况)
LOG_FILE="/var/log/acme_renew_hook.log"
# Nginx 服务在 docker-compose.yml 中的名称
NGINX_SERVICE_NAME="nginx" # Default name, adjust if different
# --- 配置结束 ---

# 函数：记录日志并输出到控制台
log_message() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE"
}

log_message "acme.sh 续签钩子脚本开始执行 (针对 Nginx in $COMPOSE_PROJECT_DIR)..."

# 检查 Docker Compose 项目目录是否存在
if [ ! -d "$COMPOSE_PROJECT_DIR" ]; then
  log_message "错误：Docker Compose 项目目录 '$COMPOSE_PROJECT_DIR' 不存在。"
  exit 1 # Exit if the specific project directory isn't found
fi

# 进入 Docker Compose 项目目录
pushd "$COMPOSE_PROJECT_DIR" > /dev/null || { log_message "错误：无法进入目录 '$COMPOSE_PROJECT_DIR'"; exit 1; }

log_message "当前目录：$(pwd)"

# 1. 平滑重载 Nginx 配置
log_message "尝试重载 Nginx 配置 (服务名: $NGINX_SERVICE_NAME)..."
# 使用 'docker compose exec' 在运行中的 nginx 服务容器内执行命令
$DOCKER_COMPOSE_CMD exec "$NGINX_SERVICE_NAME" nginx -s reload
if [ $? -eq 0 ]; then
  log_message "Nginx 重载成功 (服务: $NGINX_SERVICE_NAME, 项目: $COMPOSE_PROJECT_DIR)。"
else
  log_message "警告：Nginx 重载失败。请检查 Nginx 配置和容器状态 (服务: $NGINX_SERVICE_NAME, 项目: $COMPOSE_PROJECT_DIR)。"
  # Consider exiting with error if reload is critical
  # exit 1
fi

# 返回原始目录
popd > /dev/null

log_message "acme.sh 续签钩子脚本执行完毕 (针对 $COMPOSE_PROJECT_DIR)。"
exit 0
