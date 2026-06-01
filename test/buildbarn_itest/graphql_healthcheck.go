package main

import (
	"bytes"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

func main() {
	httpPort := flag.Int("http-port", 0, "bb-portal HTTP port")
	flag.Parse()
	if *httpPort == 0 {
		fmt.Fprintln(os.Stderr, "missing -http-port")
		os.Exit(2)
	}

	client := &http.Client{Timeout: 2 * time.Second}
	body := []byte(`{"query":"query Health { __typename }"}`)
	resp, err := client.Post(
		fmt.Sprintf("http://127.0.0.1:%d/graphql", *httpPort),
		"application/json",
		bytes.NewReader(body),
	)
	if err != nil {
		fmt.Fprintf(os.Stderr, "health check failed: %v\n", err)
		os.Exit(1)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		responseBody, _ := io.ReadAll(resp.Body)
		fmt.Fprintf(os.Stderr, "health check returned HTTP %d: %s\n", resp.StatusCode, responseBody)
		os.Exit(1)
	}
}
