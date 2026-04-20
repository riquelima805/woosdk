// The 'test_amm_pair' test program.
import amm_pair.aleo;
program test_amm_pair.aleo {
    @test
    @should_fail
    fn test_main_fails() {
        let result: u32 = amm_pair.aleo::main(2u32, 3u32);
        assert_eq(result, 3u32);
    }

    @noupgrade
    constructor() {}
}
