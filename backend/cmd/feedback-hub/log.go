package main

import "log"

// net/http's default panic/handshake messages can include client addresses.
// Application middleware emits fixed, content-free error events instead.
func quietHTTPLog() *log.Logger { return log.New(discardLog{}, "", 0) }

type discardLog struct{}

func (discardLog) Write(b []byte) (int, error) { return len(b), nil }
