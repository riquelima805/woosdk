// The 'test_wanpedleo' test program.
import wanpedleo.aleo;
program test_wanpedleo.aleo {
    @test
    @should_fail
    fn test_main_fails() {
        let result: u32 = wanpedleo.aleo::main(2u32, 3u32);
        assert_eq(result, 3u32);
    }

    @noupgrade
    constructor() {}
}
