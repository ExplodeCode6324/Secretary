#!/usr/bin/env python3
import json, pathlib, urllib.parse, webbrowser
root=pathlib.Path(__file__).resolve().parents[1]
cfg=json.loads((root/'configs/local.json').read_text())
data=pathlib.Path(cfg['data_root'])
if not data.is_absolute(): data=root/data
token=(data/'master.token').read_text().strip()
webbrowser.open('http://'+cfg['listen']+'/#token='+urllib.parse.quote(token,safe=''))
