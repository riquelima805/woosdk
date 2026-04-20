use anyhow::{Context, Result};
use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    Json,
    Router,
};
use serde::{Deserialize, Serialize};
use snarkvm::prelude::*;
use snarkvm::ledger::store::ConsensusStore;
use snarkvm::ledger::store::helpers::memory::ConsensusMemory;
use std::fs;
use std::str::FromStr;
use std::sync::Arc;
use std::collections::HashMap;
use tokio::sync::RwLock;

type CurrentNetwork = Testnet3;



#[derive(Deserialize)]
pub struct ExecuteRequest {
    aleo_file_path: String,
    function_name: String,
    private_key: String,
    inputs: Vec<String>,
}

#[derive(Serialize)]
pub struct StateChange {
    pub kind: String,
    pub contract: String,
    pub mapping: Option<String>,
    pub key: Option<String>,
    pub value: Option<String>,
    pub sender: Option<String>,
    pub receiver: Option<String>,
    pub amount: Option<u64>,
}

#[derive(Serialize)]
pub struct ExecuteResponse {
    pub proof: String,
    pub public_inputs: Vec<String>,
    pub state_changes: Vec<StateChange>,
}

#[derive(Deserialize)]
pub struct VerifyRequest {
    pub aleo_file_path: String,
    pub function_name: String,
    pub proof: String,
    pub inputs: Vec<String>,
}

#[derive(Serialize)]
pub struct VerifyResponse {
    pub valid: bool,
}



struct AppState {
    vm: VM<CurrentNetwork, ConsensusMemory<CurrentNetwork>>, 
    programs: Arc<RwLock<HashMap<String, Program<CurrentNetwork>>>>,
}

impl AppState {
    async fn load_program(&self, file_path: &str) -> Result<Program<CurrentNetwork>> {
        {
            let cache = self.programs.read().await;
            if let Some(program) = cache.get(file_path) {
                return Ok(program.clone());
            }
        }

        let program_string = fs::read_to_string(file_path)
            .context("Erro ao ler arquivo .aleo")?;

        let clean_program_lines: Vec<&str> = program_string
            .lines()
            .filter(|line| {
                let trimmed = line.trim();
                !trimmed.starts_with("constructor:") && !trimmed.starts_with("assert.eq edition")
            })
            .collect();

        let clean_program_string = clean_program_lines.join("\n");
        let program = Program::<CurrentNetwork>::from_str(&clean_program_string)
            .context("Erro ao parsear programa")?;

        {
            let mut cache = self.programs.write().await;
            cache.insert(file_path.to_string(), program.clone());
        }

        let process = self.vm.process();
        process.write().add_program(&program)
            .context("Erro ao adicionar programa na VM")?;

        Ok(program)
    }
}

async fn execute_handler(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ExecuteRequest>,
) -> impl IntoResponse {
    // 1. Carregar programa
    let program = match state.load_program(&req.aleo_file_path).await {
        Ok(p) => p,
        Err(e) => return (StatusCode::BAD_REQUEST, format!("Erro ao carregar programa: {}", e)).into_response(),
    };

    
    let private_key = match PrivateKey::<CurrentNetwork>::from_str(&req.private_key) {
        Ok(k) => k,
        Err(e) => return (StatusCode::BAD_REQUEST, format!("Private key inválida: {}", e)).into_response(),
    };

    
    let mut parsed_inputs = Vec::new();
    for input in &req.inputs {
        match Value::<CurrentNetwork>::from_str(input) {
            Ok(val) => parsed_inputs.push(val),
            Err(e) => return (StatusCode::BAD_REQUEST, format!("Input inválido '{}': {}", input, e)).into_response(),
        }
    }

    let program_id = program.id().to_string();
    let caller_address = Address::try_from(&private_key)
        .map(|a| a.to_string())
        .unwrap_or_else(|_| "unknown".to_string());

    let mut rng = TestRng::default();

    
    let transaction = match state.vm.execute(
        &private_key,
        (program_id.as_str(), req.function_name.as_str()),
        parsed_inputs.iter(),
        None,
        0u64,
        None,
        &mut rng,
    ) {
        Ok(tx) => tx,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, format!("Erro na execução: {}", e)).into_response(),
    };

    let execution = match transaction.execution() {
        Some(ex) => ex,
        None => return (StatusCode::INTERNAL_SERVER_ERROR, "Transaçao nao contem execução".to_string()).into_response(),
    };

    let mut state_changes = Vec::new();

    
    
    if req.function_name == "transfer_public" && req.inputs.len() >= 2 {
        let recipient = req.inputs[0].clone();
        let amount_str = req.inputs[1].clone();
        let amount = amount_str
            .replace("u64", "")
            .replace(".public", "")
            .replace(".private", "")
            .trim()
            .parse::<u64>()
            .unwrap_or(0);

        state_changes.push(StateChange {
            kind: "transfer".to_string(),
            contract: program_id.clone(),
            mapping: None,
            key: None,
            value: None,
            sender: Some(caller_address.clone()),
            receiver: Some(recipient),
            amount: Some(amount),
        });
    }

    
    for (transition_index, transition) in execution.transitions().enumerate() {
        
        for (output_index, output) in transition.outputs().iter().enumerate() {
            let value_str = output.to_string();

            
            if value_str.contains("\"type\":\"future\"") || value_str.contains("\"type\": \"future\"") {
                if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&value_str) {
                    if let Some(inner_val_str) = json_val.get("value").and_then(|v| v.as_str()) {
                        let mut prog_id = String::new();
                        let mut func_name = String::new();
                        let mut clean_args = Vec::new();

                        
                        for line in inner_val_str.lines() {
                            let trimmed = line.trim();
                            if trimmed.starts_with("program_id:") {
                                prog_id = trimmed.replace("program_id:", "").replace(",", "").trim().to_string();
                            } else if trimmed.starts_with("function_name:") {
                                func_name = trimmed.replace("function_name:", "").replace(",", "").trim().to_string();
                            } else if !trimmed.starts_with("arguments:") && !trimmed.starts_with("{") && !trimmed.starts_with("}") && !trimmed.is_empty() {
                                
                                let clean_arg = trimmed.replace(",", "")
                                    .replace("u128", "").replace("u64", "").replace("u32", "").replace("u16", "").replace("u8", "")
                                    .replace(".public", "").replace(".private", "").trim().to_string();
                                
                                if !clean_arg.is_empty() && clean_arg != "]" {
                                    clean_args.push(clean_arg);
                                }
                            }
                        }

                        
                        let args_json = serde_json::to_string(&clean_args).unwrap_or_default();

                        state_changes.push(StateChange {
                            kind: "future_execution".to_string(),
                            contract: prog_id,
                            mapping: Some(func_name), 
                            key: None,
                            value: Some(args_json),   
                            sender: None,
                            receiver: None,
                            amount: None,
                        });
                        continue; 
                    }
                }
            }

            
            state_changes.push(StateChange {
                kind: "output".to_string(),
                contract: transition.program_id().to_string(),
                mapping: None,
                key: Some(format!("transition_{}_output_{}", transition_index, output_index)),
                value: Some(value_str),
                sender: None,
                receiver: None,
                amount: None,
            });
        }
    }
    


    let response = ExecuteResponse {
        proof: execution.to_string(),
        public_inputs: req.inputs.clone(),
        state_changes,
    };

    (StatusCode::OK, Json(response)).into_response()
}
async fn verify_handler(
    State(state): State<Arc<AppState>>,
    Json(req): Json<VerifyRequest>,
) -> impl IntoResponse {
    match state.load_program(&req.aleo_file_path).await {
        Ok(_) => {}
        Err(e) => return (StatusCode::BAD_REQUEST, format!("Erro ao carregar programa: {}", e)).into_response(),
    };

    let execution = match Execution::<CurrentNetwork>::from_str(&req.proof) {
        Ok(ex) => ex,
        Err(e) => return (StatusCode::BAD_REQUEST, format!("String da prova inválida: {}", e)).into_response(),
    };

    let process = state.vm.process(); 
    let process_guard = process.read();
    
    let verification_result = process_guard.verify_execution(&execution);

    let is_valid = verification_result.is_ok();
    
    if !is_valid {
        eprintln!("Falha na verificação da prova: {:?}", verification_result.err());
    } else {
        println!("Prova verificada com sucesso!");
    }

    (StatusCode::OK, Json(VerifyResponse { valid: is_valid })).into_response()
}



#[tokio::main]
async fn main() -> Result<()> {
    let store = ConsensusStore::<CurrentNetwork, ConsensusMemory<CurrentNetwork>>::open(None)
        .context("Erro ao criar ConsensusStore")?;
    let vm = VM::from(store).context("Erro ao criar VM")?;

    let state = Arc::new(AppState {
        vm, 
        programs: Arc::new(RwLock::new(HashMap::new())),
    });

    let app = Router::new()
        .route("/execute", axum::routing::post(execute_handler))
        .route("/verify", axum::routing::post(verify_handler))
        .layer(tower_http::cors::CorsLayer::permissive())
        .with_state(state);

    let port = 3030;
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port))
        .await
        .context("Erro ao bind na porta")?;
    
    println!(" Servidor rodando em http://localhost:{}", port);
    
    axum::serve(listener, app)
        .await
        .context("Erro")?;

    Ok(())
}