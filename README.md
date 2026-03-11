# cnb
- 在 ./edge-functions 目录下创建 index.js，访问根路径则会进入到该函数而非首页。
- 在 ./edge-functions 目录下创建 [[path]].js，除根路径外其他所有路径都会进入到该函数，需在函数内处理静态资源的返回。