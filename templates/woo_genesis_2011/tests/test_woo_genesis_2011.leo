// The 'test_woo_genesis_2011' test program.
import woo_genesis_2011.aleo;
program test_woo_genesis_2011.aleo {
    @test
    @should_fail
    fn test_main_fails() {
        let result: u32 = woo_genesis_2011.aleo::main(2u32, 3u32);
        assert_eq(result, 3u32);
    }

    @noupgrade
    constructor() {}
}
