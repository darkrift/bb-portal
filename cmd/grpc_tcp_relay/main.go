package main

import (
	"context"
	"flag"
	"io"
	"log"
	"net"
	"sync"
	"time"
)

type listenAddresses []string

func (a *listenAddresses) String() string {
	return ""
}

func (a *listenAddresses) Set(value string) error {
	*a = append(*a, value)
	return nil
}

func copyAndClose(dst, src *net.TCPConn) {
	_, _ = io.Copy(dst, src)
	_ = dst.CloseWrite()
	_ = src.CloseRead()
}

func relay(ctx context.Context, downstream net.Conn, upstreamAddress string) {
	defer downstream.Close()

	upstream, err := net.DialTimeout("tcp", upstreamAddress, 10*time.Second)
	if err != nil {
		log.Printf("Failed to connect to upstream %s: %v", upstreamAddress, err)
		return
	}
	defer upstream.Close()

	downstreamTCP, downstreamOK := downstream.(*net.TCPConn)
	upstreamTCP, upstreamOK := upstream.(*net.TCPConn)
	if !downstreamOK || !upstreamOK {
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			_, _ = io.Copy(upstream, downstream)
		}()
		go func() {
			defer wg.Done()
			_, _ = io.Copy(downstream, upstream)
		}()
		wg.Wait()
		return
	}

	done := make(chan struct{})
	go func() {
		copyAndClose(upstreamTCP, downstreamTCP)
		close(done)
	}()
	go copyAndClose(downstreamTCP, upstreamTCP)

	select {
	case <-done:
	case <-ctx.Done():
	}
}

func serve(ctx context.Context, listenAddress, upstreamAddress string) error {
	listener, err := net.Listen("tcp", listenAddress)
	if err != nil {
		return err
	}
	defer listener.Close()

	log.Printf("Relaying TCP streams from %s to %s", listenAddress, upstreamAddress)
	go func() {
		<-ctx.Done()
		_ = listener.Close()
	}()

	for {
		conn, err := listener.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return err
		}
		go relay(ctx, conn, upstreamAddress)
	}
}

func main() {
	var addresses listenAddresses
	flag.Var(&addresses, "listen", "TCP listen address. May be repeated.")
	upstreamAddress := flag.String("connect", "", "TCP upstream address")
	flag.Parse()

	if len(addresses) == 0 {
		addresses = append(addresses, ":8981")
	}
	if *upstreamAddress == "" {
		log.Fatal("Missing required -connect address")
	}

	ctx := context.Background()
	errCh := make(chan error, len(addresses))
	for _, address := range addresses {
		go func(address string) {
			errCh <- serve(ctx, address, *upstreamAddress)
		}(address)
	}
	if err := <-errCh; err != nil {
		log.Fatal(err)
	}
}
