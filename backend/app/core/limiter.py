"""Shared SlowAPI rate-limiter singleton.

Import this everywhere instead of re-creating Limiter(key_func=get_remote_address)
in each router module.  All nine router files previously had an identical line.
"""
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
