# Tampermonkey
My tampermonkey scripts for some website.

## Moodle

Moodle/moodle.js

1. 自动化嗅探课程下载资源
2. 提供批量下载功能

Automatically sniff web download resources and provide batch download function.

TODO: 

\[ISSUE\] 对于.ipynb、.py等文件，不在服务器白名单中，目前的方法是添加.txt后缀，让用户在本地手动删除。希望通过blob能够改进。

\[BUG\] 对于下载文件链接后含参数的情况，如?time=xxxxx，目前的方法同上。希望通过添加函数清洗url的方式解决。

\[ISSUE\] 未对可能非“pluginfile.php”方式存储的文件进行嗅探。
