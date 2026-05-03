

fn safe_u128_to_u64(n: u128) -> u64 {
    assert(n <= 18_446_744_073_709_551_615u128);
    return n as u64;
}

fn isqrt128(n: u128) -> u64 {
    if n == 0u128 {
        return 0u64;
    }

    let x0: u128 = n;
    let x1:  u128 = (x0  + n / x0)  / 2u128;
    let x2:  u128 = (x1  + n / x1)  / 2u128;
    let x3:  u128 = (x2  + n / x2)  / 2u128;
    let x4:  u128 = (x3  + n / x3)  / 2u128;
    let x5:  u128 = (x4  + n / x4)  / 2u128;
    let x6:  u128 = (x5  + n / x5)  / 2u128;
    let x7:  u128 = (x6  + n / x6)  / 2u128;
    let x8:  u128 = (x7  + n / x7)  / 2u128;
    let x9:  u128 = (x8  + n / x8)  / 2u128;
    let x10: u128 = (x9  + n / x9)  / 2u128;
    let x11: u128 = (x10 + n / x10) / 2u128;
    let x12: u128 = (x11 + n / x11) / 2u128;

    let result: u128 = x11 < x12 ? x11 : x12;
    return safe_u128_to_u64(result);
}

fn canonical_pair_id(token_x: field, token_y: field) -> field {
    let h1: field = BHP256::hash_to_field(token_x);
    return BHP256::hash_to_field(h1 + token_y);
}

fn balance_key(token_id: field, user: address) -> field {
    let h1: field = BHP256::hash_to_field(token_id);
    let u: field = user as field;
    return BHP256::hash_to_field(h1 + u);
}

fn lp_key(pair_id: field, user: address) -> field {
    let h1: field = BHP256::hash_to_field(pair_id);
    let u: field = user as field;
    return BHP256::hash_to_field(h1 + u);
}

fn assert_canonical_order(token_x: field, token_y: field) {
    assert(token_x != token_y);
    assert(token_x < token_y);
}



program woo_dex.aleo {

    struct Pool {
        reserve_x:    u64,
        reserve_y:    u64,
        total_shares: u64,
        token_x:      field,
        token_y:      field,
    }

    mapping balances:  field => u64;
    mapping pools:     field => Pool;
    mapping lp_shares: field => u64;

    const MINIMUM_LIQUIDITY: u64 = 1000u64;
    const MINIMUM_LP_MINT:   u64 = 100u64;
    const MIN_SEED:          u64 = 1_000_000u64;

   

    fn deposit(
        public token_id: field,
        public amount:   u64,
    ) -> Final {
        assert(amount > 0u64);
        let caller: address = self.caller;
        let key: field      = balance_key(token_id, caller);

        return final {
            let current: u64 = balances.get_or_use(key, 0u64);
            balances.set(key, current + amount);
        };
    }

   

    fn withdraw(
        public token_id: field,
        public amount:   u64,
    ) -> Final {
        assert(amount > 0u64);
        let caller: address = self.caller;
        let key: field      = balance_key(token_id, caller);

        return final {
            let current: u64 = balances.get(key);
            assert(current >= amount);
            balances.set(key, current - amount);
        };
    }

    

    fn initialize_pool(
        public token_x:  field,
        public token_y:  field,
        public amount_x: u64,
        public amount_y: u64,
    ) -> Final {
        assert(amount_x >= MIN_SEED);
        assert(amount_y >= MIN_SEED);
        assert_canonical_order(token_x, token_y);

        let caller:  address = self.caller;
        let pair_id: field   = canonical_pair_id(token_x, token_y);
        let key_x:   field   = balance_key(token_x, caller);
        let key_y:   field   = balance_key(token_y, caller);

        let product:  u128 = amount_x as u128 * amount_y as u128;
        let lp_total: u64  = isqrt128(product);

        return final {
            let existing: Pool = pools.get_or_use(pair_id, Pool {
                reserve_x:    0u64,
                reserve_y:    0u64,
                total_shares: 0u64,
                token_x:      token_x,
                token_y:      token_y,
            });

            assert(existing.total_shares == 0u64);
            assert(lp_total > MINIMUM_LIQUIDITY);

            let lp_to_caller: u64 = lp_total - MINIMUM_LIQUIDITY;
            assert(lp_to_caller > MINIMUM_LP_MINT);

            let bal_x: u64 = balances.get(key_x);
            assert(bal_x >= amount_x);
            balances.set(key_x, bal_x - amount_x);

            let bal_y: u64 = balances.get(key_y);
            assert(bal_y >= amount_y);
            balances.set(key_y, bal_y - amount_y);

            pools.set(pair_id, Pool {
                reserve_x:    amount_x,
                reserve_y:    amount_y,
                total_shares: lp_total,
                token_x:      token_x,
                token_y:      token_y,
            });

            let dead: address = aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc;
            let dead_key: field = lp_key(pair_id, dead);
            lp_shares.set(dead_key, MINIMUM_LIQUIDITY);

            let caller_lp_key: field = lp_key(pair_id, caller);
            lp_shares.set(caller_lp_key, lp_to_caller);
        };
    }

    

    fn add_liquidity(
        public token_x:          field,
        public token_y:          field,
        public amount_x_desired: u64,
        public amount_y_desired: u64,
        public amount_x_min:     u64,
        public amount_y_min:     u64,
        public lp_min:           u64,
    ) -> Final {
        assert(amount_x_desired > 0u64);
        assert(amount_y_desired > 0u64);
        assert(amount_x_desired >= amount_x_min);
        assert(amount_y_desired >= amount_y_min);
        assert_canonical_order(token_x, token_y);

        let caller:  address = self.caller;
        let pair_id: field   = canonical_pair_id(token_x, token_y);
        let key_x:   field   = balance_key(token_x, caller);
        let key_y:   field   = balance_key(token_y, caller);
        let clp_key: field   = lp_key(pair_id, caller);

        return final {
            let pool: Pool = pools.get(pair_id);
            assert(pool.total_shares > 0u64);
            assert(pool.reserve_x > 0u64);
            assert(pool.reserve_y > 0u64);

            let y_opt_128: u128 = amount_x_desired as u128 * pool.reserve_y as u128 / pool.reserve_x as u128;
            let y_optimal: u64  = safe_u128_to_u64(y_opt_128);

            let x_from_y_128: u128 = amount_y_desired as u128 * pool.reserve_x as u128 / pool.reserve_y as u128;
            let x_from_y: u64      = safe_u128_to_u64(x_from_y_128);

            let amount_x: u64 = y_optimal <= amount_y_desired ? amount_x_desired : x_from_y;
            let amount_y: u64 = y_optimal <= amount_y_desired ? y_optimal : amount_y_desired;

            assert(amount_x >= amount_x_min);
            assert(amount_y >= amount_y_min);

            let lp_from_x_128: u128 = amount_x as u128 * pool.total_shares as u128 / pool.reserve_x as u128;
            let lp_from_y_128: u128 = amount_y as u128 * pool.total_shares as u128 / pool.reserve_y as u128;
            let lp_from_x: u64      = safe_u128_to_u64(lp_from_x_128);
            let lp_from_y: u64      = safe_u128_to_u64(lp_from_y_128);
            let lp_minted: u64      = lp_from_x < lp_from_y ? lp_from_x : lp_from_y;

            assert(lp_minted >= lp_min);
            assert(lp_minted > MINIMUM_LP_MINT);

            let bal_x: u64 = balances.get(key_x);
            assert(bal_x >= amount_x);
            balances.set(key_x, bal_x - amount_x);

            let bal_y: u64 = balances.get(key_y);
            assert(bal_y >= amount_y);
            balances.set(key_y, bal_y - amount_y);

            let current_lp: u64 = lp_shares.get_or_use(clp_key, 0u64);
            lp_shares.set(clp_key, current_lp + lp_minted);

            let new_rx: u64 = pool.reserve_x + amount_x;
            let new_ry: u64 = pool.reserve_y + amount_y;
            let new_ts: u64 = pool.total_shares + lp_minted;

            let k_old: u128 = pool.reserve_x as u128 * pool.reserve_y as u128;
            let k_new: u128 = new_rx as u128 * new_ry as u128;
            assert(k_new >= k_old);

            pools.set(pair_id, Pool {
                reserve_x:    new_rx,
                reserve_y:    new_ry,
                total_shares: new_ts,
                token_x:      pool.token_x,
                token_y:      pool.token_y,
            });
        };
    }

    

    fn remove_liquidity(
        public token_x:      field,
        public token_y:      field,
        public shares:       u64,
        public amount_x_min: u64,
        public amount_y_min: u64,
    ) -> Final {
        assert(shares > 0u64);
        assert_canonical_order(token_x, token_y);

        let caller:  address = self.caller;
        let pair_id: field   = canonical_pair_id(token_x, token_y);
        let key_x:   field   = balance_key(token_x, caller);
        let key_y:   field   = balance_key(token_y, caller);
        let clp_key: field   = lp_key(pair_id, caller);

        return final {
            let pool: Pool = pools.get(pair_id);
            assert(pool.total_shares > 0u64);

            let caller_shares: u64 = lp_shares.get(clp_key);
            assert(caller_shares >= shares);

            let amount_x_128: u128 = shares as u128 * pool.reserve_x as u128 / pool.total_shares as u128;
            let amount_y_128: u128 = shares as u128 * pool.reserve_y as u128 / pool.total_shares as u128;
            let amount_x: u64      = safe_u128_to_u64(amount_x_128);
            let amount_y: u64      = safe_u128_to_u64(amount_y_128);

            assert(amount_x >= amount_x_min);
            assert(amount_y >= amount_y_min);

            lp_shares.set(clp_key, caller_shares - shares);

            let bal_x: u64 = balances.get_or_use(key_x, 0u64);
            balances.set(key_x, bal_x + amount_x);

            let bal_y: u64 = balances.get_or_use(key_y, 0u64);
            balances.set(key_y, bal_y + amount_y);

            let new_rx: u64 = pool.reserve_x - amount_x;
            let new_ry: u64 = pool.reserve_y - amount_y;
            let new_ts: u64 = pool.total_shares - shares;

            assert(new_ts >= MINIMUM_LIQUIDITY);
            assert(new_rx > 0u64);
            assert(new_ry > 0u64);

            pools.set(pair_id, Pool {
                reserve_x:    new_rx,
                reserve_y:    new_ry,
                total_shares: new_ts,
                token_x:      pool.token_x,
                token_y:      pool.token_y,
            });
        };
    }

  

    fn swap_x_for_y(
        public token_x:      field,
        public token_y:      field,
        public amount_x_in:  u64,
        public amount_y_min: u64,
        public deadline:     u32,
    ) -> Final {
        assert(amount_x_in > 0u64);
        assert_canonical_order(token_x, token_y);

        let caller:  address = self.caller;
        let pair_id: field   = canonical_pair_id(token_x, token_y);
        let key_x:   field   = balance_key(token_x, caller);
        let key_y:   field   = balance_key(token_y, caller);

        return final {
            assert(block.height <= deadline);

            let pool: Pool = pools.get(pair_id);
            assert(pool.reserve_x > 0u64);
            assert(pool.reserve_y > 0u64);

            let bal_x: u64 = balances.get(key_x);
            assert(bal_x >= amount_x_in);

            let x_fee: u128       = amount_x_in as u128 * 997u128;
            let numerator: u128   = x_fee * pool.reserve_y as u128;
            let denominator: u128 = pool.reserve_x as u128 * 1000u128 + x_fee;

            let amount_y_out: u64 = safe_u128_to_u64(numerator / denominator);

            assert(amount_y_out >= amount_y_min);
            assert(amount_y_out > 0u64);
            assert(amount_y_out < pool.reserve_y);

            balances.set(key_x, bal_x - amount_x_in);
            let bal_y: u64 = balances.get_or_use(key_y, 0u64);
            balances.set(key_y, bal_y + amount_y_out);

            let new_rx: u64 = pool.reserve_x + amount_x_in;
            let new_ry: u64 = pool.reserve_y - amount_y_out;

            let k_old: u128 = pool.reserve_x as u128 * pool.reserve_y as u128;
            let k_new: u128 = new_rx as u128 * new_ry as u128;
            assert(k_new >= k_old);

            pools.set(pair_id, Pool {
                reserve_x:    new_rx,
                reserve_y:    new_ry,
                total_shares: pool.total_shares,
                token_x:      pool.token_x,
                token_y:      pool.token_y,
            });
        };
    }

    

    fn swap_y_for_x(
        public token_x:      field,
        public token_y:      field,
        public amount_y_in:  u64,
        public amount_x_min: u64,
        public deadline:     u32,
    ) -> Final {
        assert(amount_y_in > 0u64);
        assert_canonical_order(token_x, token_y);

        let caller:  address = self.caller;
        let pair_id: field   = canonical_pair_id(token_x, token_y);
        let key_x:   field   = balance_key(token_x, caller);
        let key_y:   field   = balance_key(token_y, caller);

        return final {
            assert(block.height <= deadline);

            let pool: Pool = pools.get(pair_id);
            assert(pool.reserve_x > 0u64);
            assert(pool.reserve_y > 0u64);

            let bal_y: u64 = balances.get(key_y);
            assert(bal_y >= amount_y_in);

            let y_fee: u128       = amount_y_in as u128 * 997u128;
            let numerator: u128   = y_fee * pool.reserve_x as u128;
            let denominator: u128 = pool.reserve_y as u128 * 1000u128 + y_fee;

            let amount_x_out: u64 = safe_u128_to_u64(numerator / denominator);

            assert(amount_x_out >= amount_x_min);
            assert(amount_x_out > 0u64);
            assert(amount_x_out < pool.reserve_x);

            balances.set(key_y, bal_y - amount_y_in);
            let bal_x: u64 = balances.get_or_use(key_x, 0u64);
            balances.set(key_x, bal_x + amount_x_out);

            let new_rx: u64 = pool.reserve_x - amount_x_out;
            let new_ry: u64 = pool.reserve_y + amount_y_in;

            let k_old: u128 = pool.reserve_x as u128 * pool.reserve_y as u128;
            let k_new: u128 = new_rx as u128 * new_ry as u128;
            assert(k_new >= k_old);

            pools.set(pair_id, Pool {
                reserve_x:    new_rx,
                reserve_y:    new_ry,
                total_shares: pool.total_shares,
                token_x:      pool.token_x,
                token_y:      pool.token_y,
            });
        };
    }
}
