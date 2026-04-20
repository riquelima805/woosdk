program token13.aleo {

    
    mapping account: address => u64;

    
    fn mint_public(public amount: u64, public receiver: address) -> Final {
        // A transação gera a prova ZK, e o bloco final atualiza o estado público
        return final {
            // get_or_use lê o saldo atual, se não existir assume 0
            let current_balance: u64 = Mapping::get_or_use(account, receiver, 0u64);
            Mapping::set(account, receiver, current_balance + amount);
        };
    }

    
    fn transfer_public(public to: address, public amount: u64) -> Final {
       
        let sender: address = self.caller;
        
        return final {
            let sender_balance: u64 = Mapping::get_or_use(account, sender, 0u64);
            
            
            assert(sender_balance >= amount);
            
            Mapping::set(account, sender, sender_balance - amount);

            let receiver_balance: u64 = Mapping::get_or_use(account, to, 0u64);
            Mapping::set(account, to, receiver_balance + amount);
        };
    }
}