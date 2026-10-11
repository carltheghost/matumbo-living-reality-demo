"""Fail closed for public deployment; never trust arbitrary proxy headers."""
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit
import os

LOOPBACK={'localhost','127.0.0.1','::1'}

def normalize_origin(value):
    if not value:return None
    if not isinstance(value,str):raise ValueError('Public origin must be text')
    p=urlsplit(value)
    if p.scheme not in ('http','https') or not p.hostname:
        raise ValueError('Public origin must be an HTTP(S) origin')
    if p.username or p.password or p.query or p.fragment or p.path not in ('','/'):
        raise ValueError('Public origin must not contain credentials, a path, query or fragment')
    try:p.port
    except ValueError as e:raise ValueError('Invalid public port') from e
    if p.scheme!='https' and p.hostname not in LOOPBACK:
        raise ValueError('Non-local public origins must use HTTPS')
    return p.scheme+'://'+p.netloc

def validate_network_settings(host,origin,key,db,web_root):
    origin=normalize_origin(origin)
    if Path(db).resolve().is_relative_to(Path(web_root).resolve()):
        raise ValueError('The database must be outside the public web directory')
    if host not in LOOPBACK:
        if not origin or not origin.startswith('https://'):
            raise ValueError('Set VIVA_PUBLIC_ORIGIN to the exact hosted HTTPS origin before public binding')
        if not isinstance(key,str) or len(key)<32 or key.upper().startswith(('REPLACE','YOUR','CHANGE')):
            raise ValueError('Set VIVA_CREATE_KEY to a fresh random secret of at least 32 characters')
    return origin

def public_origin():
    explicit=os.getenv('VIVA_PUBLIC_ORIGIN')
    domain=os.getenv('RAILWAY_PUBLIC_DOMAIN')
    return normalize_origin(explicit or ('https://'+domain if domain else None))
