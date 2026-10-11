"""Start the actual shared authority; public settings are validated before bind."""
import argparse,os
from pathlib import Path
from aiohttp import web
from .app import make_app,ROOT
from .config import validate_network_settings,public_origin

def main():
    p=argparse.ArgumentParser(description='Viva shared authority and phone client')
    p.add_argument('--host',default='127.0.0.1')
    p.add_argument('--port',type=int,default=int(os.getenv('PORT','8765')))
    p.add_argument('--db',default=os.getenv('VIVA_DB',str(ROOT/'data'/'viva.sqlite')))
    a=p.parse_args()
    if not 1<=a.port<=65535:p.error('Port must be between 1 and 65535')
    try:origin=validate_network_settings(a.host,public_origin(),os.getenv('VIVA_CREATE_KEY'),a.db,ROOT/'web')
    except ValueError as e:p.error(str(e))
    web.run_app(make_app(a.db,origin=origin),host=a.host,port=a.port,access_log=None)

if __name__=='__main__':main()
