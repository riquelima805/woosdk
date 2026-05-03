program wanpedleo.aleo {

    
    const OWNER: address = aleo1s69ylwn0x29fudj6jep5y2ljlr36964537zpe0vexmk5syyjpy8swdazp3;

    mapping account: address => u64;

    fn mint_public(public amount: u64, public receiver: address) -> Final {

        let caller: address = self.caller;

        
        assert(caller == OWNER);

        return final {
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
