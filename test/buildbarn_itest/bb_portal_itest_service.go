package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"syscall"

	"github.com/bazelbuild/rules_go/go/runfiles"
	"github.com/buildbarn/bb-portal/internal/database/embedded"
)

func main() {
	httpPort := flag.Int("http-port", 0, "HTTP port for bb-portal")
	besPort := flag.Int("bes-port", 0, "BES gRPC port for bb-portal")
	calPort := flag.Int("cal-port", 0, "CompletedActionLogger gRPC port for bb-portal")
	diagnosticsPort := flag.Int("diagnostics-port", 0, "Diagnostics HTTP port for bb-portal")
	flag.Parse()

	if *httpPort == 0 || *besPort == 0 || *calPort == 0 || *diagnosticsPort == 0 {
		log.Fatalf("all ports must be set: http=%d bes=%d cal=%d diagnostics=%d", *httpPort, *besPort, *calPort, *diagnosticsPort)
	}

	dbProvider, err := embedded.NewDatabaseProvider(os.Stderr)
	if err != nil {
		log.Fatalf("Failed to start embedded postgres: %v", err)
	}
	defer func() {
		if err := dbProvider.Cleanup(); err != nil {
			log.Printf("Failed to clean up embedded postgres: %v", err)
		}
	}()
	connectionString, err := dbProvider.CreateDatabaseConnectionString()
	if err != nil {
		log.Fatalf("Failed to create test database: %v", err)
	}

	workDir, err := os.MkdirTemp("", "bb-portal-itest-*")
	if err != nil {
		log.Fatalf("Failed to create work dir: %v", err)
	}
	defer os.RemoveAll(workDir)

	configPath := workDir + "/bb_portal.jsonnet"
	if err = os.WriteFile(configPath, []byte(renderConfig(connectionString, *httpPort, *besPort, *calPort, *diagnosticsPort)), 0o600); err != nil {
		log.Fatalf("Failed to write bb-portal config: %v", err)
	}

	bbPortalPath, err := runfiles.Rlocation("com_github_buildbarn_bb_portal/cmd/bb_portal/bb_portal_/bb_portal")
	if err != nil {
		log.Fatalf("Failed to locate bb_portal binary: %v", err)
	}

	cmd := exec.Command(bbPortalPath, configPath)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Env = os.Environ()

	if err = cmd.Start(); err != nil {
		log.Fatalf("Failed to start bb_portal: %v", err)
	}

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		sig := <-signals
		log.Printf("Forwarding %s to bb_portal", sig)
		if cmd.Process != nil {
			_ = cmd.Process.Signal(sig)
		}
	}()

	if err = cmd.Wait(); err != nil {
		log.Fatalf("bb_portal exited: %v", err)
	}
}

func renderConfig(connectionString string, httpPort, besPort, calPort, diagnosticsPort int) string {
	return fmt.Sprintf(`{
  global: {
    diagnosticsHttpServer: {
      httpServers: [{
        listenAddresses: ['127.0.0.1:%[5]d'],
        authenticationPolicy: { allow: {} },
      }],
      enablePrometheus: true,
    },
  },

  httpServers: [{
    listenAddresses: ['127.0.0.1:%[2]d'],
    authenticationPolicy: { allow: {} },
  }],

  instanceNameAuthorizer: { allow: {} },
  maximumMessageSizeBytes: 64 * 1024 * 1024,

  besServiceConfiguration: {
    grpcServers: [{
      listenAddresses: ['127.0.0.1:%[3]d'],
      authenticationPolicy: { allow: {} },
      maximumReceivedMessageSizeBytes: 64 * 1024 * 1024,
    }],
    database: {
      postgres: {
        connectionString: %[1]q,
      },
      connectionPoolConfiguration: {
        maxOpenConnections: 10,
        maxIdleConnections: 10,
        connectionMaxLifetime: '120s',
        connectionMaxIdleTime: '30s',
      },
    },
    enableBepFileUpload: true,
    enableGraphqlPlayground: false,
    saveDataLevel: { basicAndTarget: {} },
    databaseCleanupConfiguration: {
      cleanupInterval: '3600s',
      invocationMessageTimeout: '3600s',
      invocationRetention: '86400s',
    },
    minEventBatchDuration: '0s',
    buildKey: 'build_id',
  },

  completedActionLoggerServiceConfiguration: {
    grpcServers: [{
      listenAddresses: ['127.0.0.1:%[4]d'],
      authenticationPolicy: { allow: {} },
      maximumReceivedMessageSizeBytes: 64 * 1024 * 1024,
    }],
  },

  frontendServiceConfiguration: {
    frontendSource: { embedded: {} },
    frontendConfig: {
      companyName: 'bb-portal itest',
      grpcBackendUrl: 'grpc://127.0.0.1:%[3]d',
      featureFlags: {
        bes: {
          pageBuilds: {},
          pageInvocations: {},
          pageTargets: {},
          pageTests: {},
          pageTrends: {},
        },
      },
    },
  },
}`, connectionString, httpPort, besPort, calPort, diagnosticsPort)
}
