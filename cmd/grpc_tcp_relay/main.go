package main

import (
	"context"
	"flag"
	"io"
	"log"
	"net"
	"sync/atomic"

	cal_proto "github.com/buildbarn/bb-remote-execution/pkg/proto/completedactionlogger"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/types/known/emptypb"
)

type listenAddresses []string

func (a *listenAddresses) String() string {
	return ""
}

func (a *listenAddresses) Set(value string) error {
	*a = append(*a, value)
	return nil
}

type completedActionLoggerProxy struct {
	cal_proto.UnimplementedCompletedActionLoggerServer

	client         cal_proto.CompletedActionLoggerClient
	upstreamTarget string
	nextStreamID   uint64
}

type streamResult struct {
	direction string
	err       error
}

func outgoingContextFromIncoming(ctx context.Context) context.Context {
	if md, ok := metadata.FromIncomingContext(ctx); ok {
		return metadata.NewOutgoingContext(ctx, md.Copy())
	}
	return ctx
}

func (p *completedActionLoggerProxy) LogCompletedActions(downstream grpc.BidiStreamingServer[cal_proto.CompletedAction, emptypb.Empty]) error {
	streamID := atomic.AddUint64(&p.nextStreamID, 1)
	log.Printf("stream=%d accepted downstream upstream=%s", streamID, p.upstreamTarget)

	ctx, cancel := context.WithCancel(outgoingContextFromIncoming(downstream.Context()))
	defer cancel()

	upstream, err := p.client.LogCompletedActions(ctx)
	if err != nil {
		log.Printf("stream=%d upstream stream failed upstream=%s: %v", streamID, p.upstreamTarget, err)
		return err
	}
	log.Printf("stream=%d upstream stream established upstream=%s", streamID, p.upstreamTarget)

	results := make(chan streamResult, 2)
	go func() {
		results <- streamResult{
			direction: "downstream-to-upstream",
			err:       proxyDownstreamToUpstream(streamID, downstream, upstream),
		}
	}()
	go func() {
		results <- streamResult{
			direction: "upstream-to-downstream",
			err:       proxyUpstreamToDownstream(streamID, upstream, downstream),
		}
	}()

	first := <-results
	if first.err != nil || first.direction == "upstream-to-downstream" {
		cancel()
	}
	second := <-results

	if first.err != nil {
		log.Printf("stream=%d failed direction=%s: %v", streamID, first.direction, first.err)
		return first.err
	}
	if second.err != nil {
		log.Printf("stream=%d failed direction=%s: %v", streamID, second.direction, second.err)
		return second.err
	}
	log.Printf("stream=%d closed cleanly", streamID)
	return nil
}

func proxyDownstreamToUpstream(
	streamID uint64,
	downstream grpc.BidiStreamingServer[cal_proto.CompletedAction, emptypb.Empty],
	upstream grpc.BidiStreamingClient[cal_proto.CompletedAction, emptypb.Empty],
) error {
	var actions uint64
	for {
		action, err := downstream.Recv()
		if err == io.EOF {
			log.Printf("stream=%d direction=downstream-to-upstream downstream closed after %d actions", streamID, actions)
			if err = upstream.CloseSend(); err != nil {
				log.Printf("stream=%d direction=downstream-to-upstream upstream close-send failed: %v", streamID, err)
				return err
			}
			return nil
		}
		if err != nil {
			log.Printf("stream=%d direction=downstream-to-upstream downstream receive failed after %d actions: %v", streamID, actions, err)
			return err
		}
		if err = upstream.Send(action); err != nil {
			log.Printf("stream=%d direction=downstream-to-upstream upstream send failed after %d actions: %v", streamID, actions, err)
			return err
		}
		actions++
	}
}

func proxyUpstreamToDownstream(
	streamID uint64,
	upstream grpc.BidiStreamingClient[cal_proto.CompletedAction, emptypb.Empty],
	downstream grpc.BidiStreamingServer[cal_proto.CompletedAction, emptypb.Empty],
) error {
	var acknowledgements uint64
	for {
		ack, err := upstream.Recv()
		if err == io.EOF {
			log.Printf("stream=%d direction=upstream-to-downstream upstream closed after %d acknowledgements", streamID, acknowledgements)
			return nil
		}
		if err != nil {
			log.Printf("stream=%d direction=upstream-to-downstream upstream receive failed after %d acknowledgements: %v", streamID, acknowledgements, err)
			return err
		}
		if err = downstream.Send(ack); err != nil {
			log.Printf("stream=%d direction=upstream-to-downstream downstream send failed after %d acknowledgements: %v", streamID, acknowledgements, err)
			return err
		}
		acknowledgements++
	}
}

func serve(
	listenAddress string,
	proxy *completedActionLoggerProxy,
	maxMessageSizeBytes int,
) error {
	listener, err := net.Listen("tcp", listenAddress)
	if err != nil {
		return err
	}
	defer listener.Close()

	server := grpc.NewServer(
		grpc.MaxRecvMsgSize(maxMessageSizeBytes),
		grpc.MaxSendMsgSize(maxMessageSizeBytes),
	)
	cal_proto.RegisterCompletedActionLoggerServer(server, proxy)
	log.Printf("Serving CompletedActionLogger proxy on %s to %s", listenAddress, proxy.upstreamTarget)
	return server.Serve(listener)
}

func main() {
	var addresses listenAddresses
	flag.Var(&addresses, "listen", "gRPC listen address. May be repeated.")
	upstreamAddress := flag.String("connect", "", "gRPC upstream address")
	maxMessageSizeBytes := flag.Int("max-message-size-bytes", 64*1024*1024, "Maximum inbound and outbound gRPC message size in bytes.")
	flag.Parse()

	if len(addresses) == 0 {
		addresses = append(addresses, ":8981")
	}
	if *upstreamAddress == "" {
		log.Fatal("Missing required -connect address")
	}

	conn, err := grpc.NewClient(
		*upstreamAddress,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithDefaultCallOptions(
			grpc.MaxCallRecvMsgSize(*maxMessageSizeBytes),
			grpc.MaxCallSendMsgSize(*maxMessageSizeBytes),
		),
	)
	if err != nil {
		log.Fatalf("Failed to create upstream client for %s: %v", *upstreamAddress, err)
	}
	defer conn.Close()
	log.Printf("Created shared upstream gRPC client for %s", *upstreamAddress)

	proxy := &completedActionLoggerProxy{
		client:         cal_proto.NewCompletedActionLoggerClient(conn),
		upstreamTarget: *upstreamAddress,
	}

	errCh := make(chan error, len(addresses))
	for _, address := range addresses {
		go func(address string) {
			errCh <- serve(address, proxy, *maxMessageSizeBytes)
		}(address)
	}
	if err := <-errCh; err != nil {
		log.Fatal(err)
	}
}
