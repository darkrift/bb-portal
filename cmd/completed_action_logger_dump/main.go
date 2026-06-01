package main

import (
	"bufio"
	"context"
	"flag"
	"io"
	"log"
	"net"
	"os"
	"sync"

	cal_proto "github.com/buildbarn/bb-remote-execution/pkg/proto/completedactionlogger"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/emptypb"
)

type dumpServer struct {
	cal_proto.UnimplementedCompletedActionLoggerServer

	mu      sync.Mutex
	writer  *bufio.Writer
	marshal protojson.MarshalOptions
}

func (s *dumpServer) LogCompletedActions(stream grpc.BidiStreamingServer[cal_proto.CompletedAction, emptypb.Empty]) error {
	for {
		action, err := stream.Recv()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}

		data, err := s.marshal.Marshal(action)
		if err != nil {
			return err
		}
		s.mu.Lock()
		if _, err = s.writer.Write(data); err == nil {
			err = s.writer.WriteByte('\n')
		}
		if err == nil {
			err = s.writer.Flush()
		}
		s.mu.Unlock()
		if err != nil {
			return err
		}

		if err = stream.Send(&emptypb.Empty{}); err != nil {
			return err
		}
	}
}

func main() {
	listenAddress := flag.String("listen", "127.0.0.1:8981", "gRPC listen address")
	outputPath := flag.String("output", "-", "NDJSON output path, or - for stdout")
	flag.Parse()

	var output *os.File
	if *outputPath == "-" {
		output = os.Stdout
	} else {
		var err error
		output, err = os.OpenFile(*outputPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o640)
		if err != nil {
			log.Fatalf("Failed to open output: %v", err)
		}
		defer output.Close()
	}

	listener, err := net.Listen("tcp", *listenAddress)
	if err != nil {
		log.Fatalf("Failed to listen on %s: %v", *listenAddress, err)
	}

	server := grpc.NewServer()
	cal_proto.RegisterCompletedActionLoggerServer(server, &dumpServer{
		writer: bufio.NewWriter(output),
		marshal: protojson.MarshalOptions{
			UseProtoNames:   true,
			EmitUnpopulated: false,
		},
	})

	log.Printf("Listening for CompletedActionLogger traffic on %s", *listenAddress)
	if err = server.Serve(listener); err != nil && err != context.Canceled {
		log.Fatalf("CompletedActionLogger dump server failed: %v", err)
	}
}
